"""HTTP API and static file server.

GET reads the page after sign-in. POST signs in, signs out, starts the scan,
starts the Sunday update after it is confirmed, checks pending packages,
checks running containers, upgrades one confirmed container, or installs a
newer panel release. The package check and the guest check do not install
anything. Every other POST is refused.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import socket
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from homelab_panel.actions import start_action, start_unit
from homelab_panel.auth import (
    REMEMBER_SECONDS,
    SESSION_SECONDS,
    clear_cookie,
    hash_password,
    new_session,
    session_token,
    set_cookie,
    verify_password,
)
from homelab_panel.collect import collect_snapshot, cpu_usage
from homelab_panel.config import ConfigError, load_config, save_password_hash
from homelab_panel.guests import check_guests, reboot_required, run_guest, running_container, startup_commands, update_guest
from homelab_panel.inventory import GUEST_ID, check_packages, wanted_ids
from homelab_panel.maintenance import Maintenance, MaintenanceError, checked_now
from homelab_panel.self_update import UpdateError, describe, install_release
from homelab_panel.schedule import apply_schedule, update_due
from homelab_panel.signals import parse_resolv, pins_match, report_text
from homelab_panel.state import build_state
from homelab_panel.store import append_operator, load_checks, load_sessions, read_operator, save_checks, save_sessions

CACHE_SECONDS = 5
ACTIVE_CACHE_SECONDS = 1
BODY_LIMIT = 4096


class Panel:
    def __init__(self, config, provider, assets, starter=None, releases=None, installer=None, packages=None, guest_runner=None, maintenance=None):
        self.config = config
        self.provider = provider
        self.assets = assets
        self.starter = starter or start_unit
        self.releases = releases
        self.installer = installer
        self.packages = packages
        self.guest_runner = guest_runner
        self.maintenance = maintenance or Maintenance(config)
        self._lock = threading.Lock()
        self._at = 0.0
        self._state = None
        self._cpu_times = None
        self._release = None
        self._release_at = 0.0
        self._packages = None
        self._guest_updates = None
        self._guest_active = ""
        self._sessions = {row["token"]: row["expiry"] for row in load_sessions(config)}
        self._failures = 0
        self._locked_until = 0.0
        self._pins = {"checked": False, "rows": []}
        self._probes = {}
        stored = load_checks(config)
        if stored:
            if isinstance(stored.get("packages"), dict):
                self._packages = stored["packages"]
            if isinstance(stored.get("guest_updates"), dict):
                self._guest_updates = stored["guest_updates"]

    def _ttl(self):
        if self._guest_active or self.maintenance.active:
            return ACTIVE_CACHE_SECONDS
        if self._state and (not self._state["scan"]["idle"] or not self._state["update"]["idle"]):
            return ACTIVE_CACHE_SECONDS
        return float(self.config.get("cache_seconds") or CACHE_SECONDS)

    def state(self):
        now = time.monotonic()
        info = self._release_info(now)
        with self._lock:
            if self._state is None or now - self._at > self._ttl():
                raw = self.provider() or {}
                snapshot = dict(raw)
                snapshot["pins"] = self._pins
                snapshot["probes"] = self._probes
                snapshot["operator"] = [{"text": line, "href": "/system"} for line in read_operator(self.config)]
                built = build_state(self.config, snapshot)
                cpu_times = (snapshot.get("host") or {}).get("cpu_times")
                built["health"]["cpu_usage"] = cpu_usage(self._cpu_times, cpu_times)
                self._cpu_times = cpu_times
                self._apply_release(built, info)
                self._apply_packages(built)
                self._apply_guest_updates(built)
                built["maintenance"] = self._maintenance_status(snapshot)
                self._state = built
                self._at = now
            return self._state

    def _release_info(self, now):
        if self.releases is None:
            return None
        with self._lock:
            if self._release is not None and now - self._release_at <= 300:
                return self._release
        try:
            info = self.releases(self.config)
        except (UpdateError, OSError, ValueError):
            info = {"latest": "", "update_available": False, "error": "Could not check GitHub."}
        with self._lock:
            self._release = info
            self._release_at = now
        return info

    def _apply_release(self, state, info):
        if not info:
            return
        state["panel"]["latest"] = info.get("latest") or ""
        state["panel"]["update_available"] = bool(info.get("update_available"))
        state["panel"]["error"] = info.get("error") or ""

    def _apply_packages(self, state):
        if self._packages:
            state["packages"] = self._packages

    def _apply_guest_updates(self, state):
        stored = self._guest_updates
        if stored:
            state["guest_updates"] = {
                "checked": bool(stored.get("checked")),
                "error": stored.get("error") or "",
                "rows": [dict(row) for row in stored.get("rows") or []],
                "active": "",
            }
        state["guest_updates"]["active"] = self._guest_active or ""
        if stored and stored.get("checked_at"):
            state["guest_updates"]["checked_at"] = stored["checked_at"]

    def _maintenance_status(self, snapshot):
        units = {}
        for section in (snapshot.get("maintenance_units") or "").split("\n\n"):
            props = dict(line.split("=", 1) for line in section.splitlines() if "=" in line)
            if props.get("Id"):
                units[props["Id"]] = props
        legacy = units.get("homelab-update.timer", {})
        security = units.get("homelab-security.timer", {})
        paused = None
        if legacy.get("ActiveState") == "active":
            paused = False
        elif legacy.get("ActiveState") == "inactive" and legacy.get("UnitFileState") in {"disabled", "masked"}:
            paused = True
        if self.maintenance.settings.get("legacy_hold") is True:
            paused = True
        auto = self.maintenance.settings.get("security_auto")
        timer = "not_configured" if not self.maintenance.can_change or not isinstance(auto, dict) or auto.get("enabled") is not True else ""
        if not timer and security.get("ActiveState") in {"active", "inactive"}:
            timer = "scheduled" if security["ActiveState"] == "active" else "paused"
        return self.maintenance.status(timer, legacy_paused=paused)

    def handle(self, method, path, body=b"", headers=None):
        headers = headers or {}
        clean = path.split("?", 1)[0]
        if method == "POST" and clean == "/api/login":
            return self._login(body)
        if method == "POST" and clean == "/api/logout":
            return self._logout(headers)
        if clean.startswith("/api/"):
            if not self._authorized(headers):
                return self._json(401, {"error": "Sign in is required."})
            if method == "POST" and clean in ("/api/actions/scan", "/api/actions/update", "/api/actions/disk"):
                return self._action(clean, body)
            if method == "POST" and clean == "/api/reach/pins":
                return self._check_pins()
            if method == "POST" and clean == "/api/reach/paths":
                return self._check_paths()
            if method == "GET" and clean == "/api/report":
                return self._report()
            if method == "POST" and clean == "/api/panel/update":
                return self._panel_update()
            if method == "POST" and clean == "/api/packages/check":
                return self._check_packages()
            if method == "POST" and clean == "/api/guests/check":
                return self._check_guests()
            if method == "POST" and clean == "/api/guests/order":
                return self._order_guests(body)
            if method == "POST" and clean == "/api/jobs/update/schedule":
                return self._schedule_update(body)
            if method == "POST" and clean == "/api/password":
                return self._change_password(body, headers)
            reviewed = re.fullmatch(r"/api/maintenance/(security|apps/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79})/(preview|apply)", clean)
            if method == "POST" and reviewed:
                return self._reviewed_action(reviewed[1].removeprefix("apps/"), reviewed[2], body)
            guest_update = re.fullmatch(r"/api/guests/([^/]+)/update", clean)
            if method == "POST" and guest_update:
                return self._update_guest(guest_update.group(1), body)
            if method != "GET" or clean != "/api/state":
                return 405, {"Allow": "GET"}, b""
        elif method != "GET":
            return 405, {"Allow": "GET"}, b""
        if clean == "/api/state":
            body = json.dumps(self.state()).encode()
            return 200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, body
        asset = self.assets.get(clean)
        if asset is None and clean != "/":
            asset = self.assets.get("/")
        if asset is None:
            return 404, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, b"not found"
        headers = {"Content-Type": asset[0], "Cache-Control": "no-store"}
        return 200, headers, asset[1]

    def _reviewed_action(self, target, action, body):
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if payload is None:
            return self._json(400, {"error": "The request could not be read."})
        try:
            if action == "preview":
                return self._json(200, self.maintenance.preview(target))
            if payload.get("confirm") is not True:
                return self._json(400, {"error": "The update was not confirmed."})
            with self._lock:
                if self._guest_active:
                    return self._json(409, {"error": "A container update is active."})
                self.maintenance.apply(target, payload.get("plan_id"), self._invalidate)
                self._state = None
            self._log(f"Requested reviewed maintenance for {target}")
            return self._json(202, {"started": target})
        except MaintenanceError as exc:
            return self._json(409, {"error": str(exc)})

    def _invalidate(self):
        with self._lock:
            self._state = None
            self._at = 0.0

    def _action(self, path, body):
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if payload is None:
            return self._json(400, {"error": "The request could not be read."})
        kind = "scan" if path.endswith("/scan") else "disk" if path.endswith("/disk") else "update"
        if self.maintenance.active:
            return self._json(409, {"error": "Reviewed maintenance is active."})
        if kind == "update":
            if self.maintenance.settings.get("legacy_hold") is True:
                return self._json(409, {"error": "The legacy full update is on hold."})
            payload = _payload(body)
            if payload is None:
                return self._json(400, {"error": "The request could not be read."})
            if payload.get("dry") is True:
                return self._dry_run(payload.get("confirm") is True)
        status, result, started = start_action(
            self.config,
            kind,
            payload.get("confirm") is True,
            self.provider(),
            self.starter,
        )
        if started:
            with self._lock:
                self._state = None
                self._at = 0.0
            self._log({"scan": "Ran the scan", "update": "Started the Sunday update", "disk": "Ran the disk check"}.get(kind, "Started a job"))
        return self._json(status, result)

    def _dry_run(self, confirmed):
        if not confirmed:
            return self._json(400, {"error": "The update was not confirmed."})
        script = str(self.config.get("update_script") or "")
        if not script.startswith("/") or any(char in script for char in "\n;&|$`<>"):
            return self._json(400, {"error": "The dry run is not configured."})
        if not Path(script).is_file():
            return self._json(400, {"error": "The dry run is not configured."})
        threading.Thread(target=self._run_dry, args=(script,), daemon=True).start()
        self._log("Started a dry run")
        with self._lock:
            self._state = None
            self._at = 0.0
        return self._json(202, {"started": "dry-run"})

    def _run_dry(self, script):
        try:
            subprocess.run([script, "--dry-run"], timeout=900, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return

    def _log(self, action):
        append_operator(self.config, action)

    def _remember(self):
        save_checks(self.config, self._packages, self._guest_updates)

    def _panel_update(self):
        if self.maintenance.active or self._guest_active:
            return self._json(409, {"error": "Wait for maintenance to finish before restarting the panel."})
        if self.installer is None:
            return self._json(400, {"error": "This copy cannot install a release."})
        try:
            result = self.installer(self.config)
        except UpdateError as exc:
            return self._json(400, {"error": str(exc)})
        status = 200 if result.get("status") == "current" else 202
        if status == 202:
            self._log("Installed a panel release")
        return self._json(status, result)

    def _check_packages(self):
        if self.packages is None:
            return self._json(400, {"error": "This copy cannot check packages."})
        result = {**self.packages(), "checked_at": checked_now()}
        with self._lock:
            self._packages = result
            self._state = None
            self._at = 0.0
        self._remember()
        self._log("Checked host packages")
        return self._json(200, result)

    def _check_guests(self):
        if self.guest_runner is None:
            return self._json(400, {"error": "This copy cannot update a guest."})
        result = check_guests(self.config, self.provider(), self.guest_runner)
        with self._lock:
            result["active"] = self._guest_active or ""
            self._guest_updates = {
                "checked": True,
                "checked_at": checked_now(),
                "error": result.get("error") or "",
                "rows": result.get("rows") or [],
            }
            self._state = None
            self._at = 0.0
        self._remember()
        self._log("Checked guest packages")
        return self._json(200, result)

    def _update_guest(self, guest_id, body):
        if self.guest_runner is None:
            return self._json(400, {"error": "This copy cannot update a guest."})
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if payload is None or payload.get("confirm") is not True:
            return self._json(400, {"error": "The update was not confirmed."})
        if not GUEST_ID.fullmatch(guest_id) or guest_id not in wanted_ids(self.config):
            return self._json(400, {"error": "That guest is not configured."})
        snapshot = self.provider()
        guest = _guest(snapshot, guest_id)
        if guest is None or not running_container(self.config, guest):
            return self._json(400, {"error": "That guest is not a running container."})
        if snapshot.get("scan_active") or snapshot.get("update_active"):
            return self._json(400, {"error": "A job is already running."})
        with self._lock:
            if self._guest_active or self.maintenance.active:
                return self._json(400, {"error": "A job is already running."})
            lease = self.maintenance.exclusive() if self.maintenance.can_change else None
            if lease is not None:
                try:
                    lease.__enter__()
                except MaintenanceError as exc:
                    return self._json(409, {"error": str(exc)})
            directories = self._compose_dirs(guest_id)
            self._guest_active = guest_id
            self._state = None
            self._at = 0.0
        try:
            threading.Thread(target=self._run_guest_update, args=(guest_id, directories, lease), daemon=True).start()
        except RuntimeError:
            if lease is not None:
                lease.__exit__(None, None, None)
            with self._lock:
                self._guest_active = ""
            return self._json(503, {"error": "The container update could not start."})
        return self._json(202, {"started": guest_id})

    def _compose_dirs(self, guest_id):
        stored = self._guest_updates
        if not stored or not stored.get("checked"):
            return None
        for row in stored.get("rows") or []:
            if str(row.get("id") or "") == guest_id:
                return list(row.get("compose") or [])
        return None

    def _run_guest_update(self, guest_id, directories, lease=None):
        error = "The update did not finish."
        reboot = False
        try:
            error = update_guest(guest_id, directories, self.guest_runner) or ""
            reboot = reboot_required(guest_id, self.guest_runner)
        except Exception:
            error = "The update did not finish."
        finally:
            if lease is not None:
                lease.__exit__(None, None, None)
        with self._lock:
            self._mark_guest(guest_id, error, reboot)
            self._guest_active = ""
            self._state = None
            self._at = 0.0
        self._remember()
        self._log(f"Updated guest {guest_id}")

    def _mark_guest(self, guest_id, error, reboot=False):
        stored = self._guest_updates or {"checked": False, "error": "", "rows": []}
        rows = []
        found = False
        for row in stored.get("rows") or []:
            copied = dict(row)
            if str(copied.get("id") or "") == guest_id:
                copied["error"] = error
                copied["reboot"] = bool(reboot)
                copied["recheck"] = True
                found = True
            rows.append(copied)
        if not found:
            rows.append(
                {
                    "id": guest_id,
                    "packages": 0,
                    "security": 0,
                    "compose": [],
                    "floating": False,
                    "reboot": bool(reboot),
                    "recheck": True,
                    "error": error,
                }
            )
        self._guest_updates = {
            "checked": bool(stored.get("checked")),
            "checked_at": stored.get("checked_at"),
            "error": stored.get("error") or "",
            "rows": rows,
        }

    def _check_pins(self):
        if self.guest_runner is None:
            return self._json(400, {"error": "This copy cannot check pins."})
        snapshot = self.provider() or {}
        rows = []
        for guest in snapshot.get("guests") or []:
            expected = [str(item) for item in guest.get("nameservers") or [] if item]
            guest_id = str(guest.get("id") or "")
            if not expected or guest.get("kind") == "vm" or not GUEST_ID.fullmatch(guest_id):
                continue
            try:
                text = self.guest_runner(["pct", "exec", guest_id, "--", "cat", "/etc/resolv.conf"], 8)
            except TypeError:
                text = self.guest_runner(["pct", "exec", guest_id, "--", "cat", "/etc/resolv.conf"])
            live = parse_resolv(text or "")
            rows.append(
                {
                    "id": guest_id,
                    "name": guest.get("name") or guest_id,
                    "ok": pins_match(expected, live),
                }
            )
        result = {"checked": True, "rows": rows}
        with self._lock:
            self._pins = result
            self._state = None
            self._at = 0.0
        self._log("Checked DNS pins")
        return self._json(200, result)

    def _check_paths(self):
        probes = {}
        for item in self.config.get("paths") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            probes[name] = {"lan": _answers(item.get("lan")), "public": _answers(item.get("public"))}
        with self._lock:
            self._probes = probes
            self._state = None
            self._at = 0.0
        self._log("Checked service paths")
        return self._json(200, {"paths": probes})

    def _report(self):
        body = report_text(self.state()).encode()
        return 200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, body

    def _json(self, status, payload, extra=None):
        body = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
        if extra:
            headers.update(extra)
        return status, headers, body

    def _authorized(self, headers):
        token = session_token(headers.get("Cookie", ""))
        if not token:
            return False
        now = time.time()
        with self._lock:
            expiry = self._sessions.get(token)
            if not expiry or expiry < now:
                self._sessions.pop(token, None)
                stale = True
            else:
                stale = False
        if stale:
            self._persist_sessions()
            return False
        return True

    def _login(self, body):
        mono = time.monotonic()
        if mono < self._locked_until:
            return self._json(429, {"error": "Too many attempts. Wait a minute."})
        payload = _payload(body)
        password = ""
        if isinstance(payload, dict) and isinstance(payload.get("password"), str):
            password = payload["password"]
        if not verify_password(password, self.config.get("password_hash") or ""):
            self._failures += 1
            if self._failures >= 5:
                self._locked_until = mono + 60
                self._failures = 0
            return self._json(401, {"error": "The password does not match."})
        self._failures = 0
        remember = isinstance(payload, dict) and payload.get("remember") is True
        window = REMEMBER_SECONDS if remember else SESSION_SECONDS
        token = new_session()
        with self._lock:
            self._sessions[token] = time.time() + window
        self._persist_sessions()
        return 204, {
            "Cache-Control": "no-store",
            "Set-Cookie": set_cookie(token, window),
        }, b""

    def _logout(self, headers):
        token = session_token((headers or {}).get("Cookie", ""))
        if token:
            with self._lock:
                self._sessions.pop(token, None)
            self._persist_sessions()
        return 204, {"Cache-Control": "no-store", "Set-Cookie": clear_cookie()}, b""

    def _persist_sessions(self):
        with self._lock:
            rows = [{"token": token, "expiry": expiry} for token, expiry in self._sessions.items()]
        save_sessions(self.config, rows)

    def _schedule_update(self, body):
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if payload is None or payload.get("confirm") is not True:
            return self._json(400, {"error": "The schedule was not confirmed."})
        if self.maintenance.settings.get("legacy_hold") is True and payload.get("action") != "skip":
            return self._json(409, {"error": "The legacy full update is on hold."})
        program = Path(sys.argv[0]).resolve()
        status, result = apply_schedule(
            self.config,
            str(payload.get("action") or ""),
            payload,
            self.starter,
            executable=sys.executable,
            program=str(program),
            root=self.config.get("schedule_root") or "/",
        )
        if status == 202:
            self._log("Changed the Sunday update schedule")
            with self._lock:
                self._state = None
                self._at = 0.0
        return self._json(status, result)

    def _order_guests(self, body):
        if self.guest_runner is None:
            return self._json(400, {"error": "This copy cannot set boot order."})
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if not isinstance(payload, dict) or payload.get("confirm") is not True:
            return self._json(400, {"error": "The order was not confirmed."})
        error, commands = startup_commands(self.provider() or {}, payload.get("ids"))
        if error:
            return self._json(400, {"error": error})
        for command in commands:
            if _guest_call(self.guest_runner, command) is None:
                return self._json(400, {"error": "The order was not saved."})
        with self._lock:
            self._state = None
            self._at = 0.0
        self._log("Saved the boot order")
        return self._json(200, {"ok": True})

    def _change_password(self, body, headers):
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if not isinstance(payload, dict):
            return self._json(400, {"error": "The request could not be read."})
        current = payload.get("current")
        new = payload.get("new")
        confirm = payload.get("confirm")
        if not isinstance(current, str) or not verify_password(current, self.config.get("password_hash") or ""):
            return self._json(401, {"error": "The password does not match."})
        if not isinstance(new, str) or not new.strip() or new != confirm:
            return self._json(400, {"error": "The new password was not accepted."})
        updated = hash_password(new)
        if not save_password_hash(self.config, updated):
            return self._json(400, {"error": "The password was not saved."})
        token = session_token((headers or {}).get("Cookie", ""))
        with self._lock:
            expiry = self._sessions.get(token)
            self._sessions = {token: expiry} if token and expiry else {}
        self._persist_sessions()
        self._log("Changed the panel password")
        return self._json(200, {"ok": True})


class DirectoryAssets:
    def __init__(self, root):
        self.root = Path(root)

    def get(self, url_path):
        relative = "index.html" if url_path == "/" else url_path.lstrip("/")
        if relative.startswith("/") or ".." in Path(relative).parts:
            return None
        file = (self.root / relative).resolve()
        try:
            file.relative_to(self.root.resolve())
        except ValueError:
            return None
        if not file.is_file():
            return None
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix == ".js":
            mime = "text/javascript; charset=utf-8"
        elif file.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif file.suffix == ".html":
            mime = "text/html; charset=utf-8"
        return mime, file.read_bytes()


class ZipAssets:
    def __init__(self, archive, prefix="ui/dist/"):
        self.archive = archive
        self.prefix = prefix

    def get(self, url_path):
        relative = "index.html" if url_path == "/" else url_path.lstrip("/")
        if relative.startswith("/") or ".." in Path(relative).parts:
            return None
        name = self.prefix + relative
        try:
            with zipfile.ZipFile(self.archive) as bundle:
                data = bundle.read(name)
        except (KeyError, OSError, zipfile.BadZipFile):
            return None
        suffix = Path(relative).suffix
        if suffix == ".js":
            mime = "text/javascript; charset=utf-8"
        elif suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif suffix == ".html":
            mime = "text/html; charset=utf-8"
        else:
            mime = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        return mime, data


def assets_from_runtime():
    import sys

    argv0 = Path(sys.argv[0]).resolve()
    if zipfile.is_zipfile(argv0):
        return ZipAssets(argv0)
    root = Path(__file__).resolve().parents[1] / "ui" / "dist"
    return DirectoryAssets(root)


def make_handler(panel):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self._send(*panel.handle("GET", self.path, headers=self._headers()))

        def do_POST(self):
            raw = self.headers.get("Content-Length") or "0"
            try:
                length = int(raw)
            except ValueError:
                length = -1
            if length < 0 or length > BODY_LIMIT:
                self._send(*panel._json(400, {"error": "The request is too large."}))
                return
            body = self.rfile.read(length) if length else b""
            self._send(*panel.handle("POST", self.path, body, self._headers()))

        def _headers(self):
            return {"Cookie": self.headers.get("Cookie", "")}

        def _send(self, status, headers, body):
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            return

    return Handler


def _guest_call(runner, command):
    try:
        return runner(list(command), 20)
    except TypeError:
        try:
            return runner(list(command))
        except (OSError, subprocess.TimeoutExpired):
            return None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _guest(snapshot, guest_id):
    for guest in snapshot.get("guests") or []:
        if str(guest.get("id") or "") == guest_id:
            return guest
    return None


def _payload(body):
    if not body:
        return {}
    try:
        value = json.loads(body.decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    return value


def _answers(name):
    host = str(name or "").strip()
    if not host:
        return None
    try:
        socket.getaddrinfo(host, None)
    except OSError:
        return False
    return True


def serve(config, provider=None, assets=None):
    panel = Panel(
        config,
        provider or (lambda: collect_snapshot(config)),
        assets or assets_from_runtime(),
        releases=lambda cfg: describe(cfg),
        installer=lambda cfg: install_release(cfg, wait=False),
        packages=check_packages,
        guest_runner=run_guest,
    )
    server = ThreadingHTTPServer((config["bind_host"], config["bind_port"]), make_handler(panel))
    server.serve_forever()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Homelab master control panel")
    parser.add_argument("--config")
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--update-due", action="store_true")
    parser.add_argument("--security-auto", action="store_true")
    args = parser.parse_args(argv)
    if args.update_due:
        return _update_due(args.config)
    if args.update:
        return _update(args.config)
    if not args.config:
        raise SystemExit("--config is required")
    try:
        config = load_config(args.config)
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    if args.security_auto:
        try:
            print(Maintenance(config).automatic_security())
        except MaintenanceError as exc:
            raise SystemExit(str(exc)) from exc
        return
    if not config.get("password_hash"):
        raise SystemExit("config needs a password_hash")
    serve(config)


def _update_due(config_path):
    if not config_path:
        try:
            config_path = _config_path_from_unit(Path("/etc/systemd/system/homelab-panel.service"))
        except SystemExit:
            return 0
    try:
        config = load_config(config_path)
    except ConfigError:
        return 0
    return 0 if update_due(config) else 1


def _update(config_path):
    if config_path:
        try:
            config = load_config(config_path)
        except ConfigError as exc:
            raise SystemExit(str(exc)) from exc
    else:
        config = {"config_path": _config_path_from_unit(Path("/etc/systemd/system/homelab-panel.service"))}
    try:
        result = install_release(config, wait=True)
    except UpdateError as exc:
        raise SystemExit(str(exc)) from exc
    if result["status"] == "current":
        print(f"Already running {result['version']}")
    else:
        print(f"Installed {result['version']}")
    return 0


def _config_path_from_unit(path):
    try:
        text = path.read_text()
    except OSError as exc:
        raise SystemExit("The panel service is not installed.") from exc
    match = re.search(r"--config\s+(\S+)", text)
    if not match:
        raise SystemExit("The panel service has no config path.")
    return match.group(1)


if __name__ == "__main__":
    main()
