"""HTTP API and static file server.

GET reads the page after sign-in. POST signs in, signs out, starts the scan,
starts the update after it is confirmed, or installs a newer panel release.
Every other POST is refused.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from homelab_panel.actions import start_action, start_unit
from homelab_panel.auth import clear_cookie, new_session, session_token, set_cookie, verify_password
from homelab_panel.collect import collect_snapshot
from homelab_panel.config import ConfigError, load_config
from homelab_panel.self_update import UpdateError, describe, install_release
from homelab_panel.state import build_state

CACHE_SECONDS = 5
ACTIVE_CACHE_SECONDS = 1
BODY_LIMIT = 4096


class Panel:
    def __init__(self, config, provider, assets, starter=None, releases=None, installer=None):
        self.config = config
        self.provider = provider
        self.assets = assets
        self.starter = starter or start_unit
        self.releases = releases
        self.installer = installer
        self._lock = threading.Lock()
        self._at = 0.0
        self._state = None
        self._release = None
        self._release_at = 0.0
        self._sessions = {}
        self._failures = 0
        self._locked_until = 0.0

    def _ttl(self):
        if self._state and (not self._state["scan"]["idle"] or not self._state["update"]["idle"]):
            return ACTIVE_CACHE_SECONDS
        return float(self.config.get("cache_seconds") or CACHE_SECONDS)

    def state(self):
        now = time.monotonic()
        info = self._release_info(now)
        with self._lock:
            if self._state is None or now - self._at > self._ttl():
                built = build_state(self.config, self.provider())
                self._apply_release(built, info)
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
        for card in state["home"]["cards"]:
            if card["id"] != "panel":
                continue
            if info.get("update_available"):
                card["detail"] = "A newer release is ready."
            elif info.get("latest"):
                card["detail"] = "This is the latest release."
            elif info.get("error"):
                card["detail"] = info["error"]

    def handle(self, method, path, body=b"", headers=None):
        headers = headers or {}
        clean = path.split("?", 1)[0]
        if method == "POST" and clean == "/api/login":
            return self._login(body)
        if method == "POST" and clean == "/api/logout":
            return self._logout()
        if clean.startswith("/api/"):
            if not self._authorized(headers):
                return self._json(401, {"error": "Sign in is required."})
            if method == "POST" and clean in ("/api/actions/scan", "/api/actions/update"):
                return self._action(clean, body)
            if method == "POST" and clean == "/api/panel/update":
                return self._panel_update()
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

    def _action(self, path, body):
        if len(body) > BODY_LIMIT:
            return self._json(400, {"error": "The request is too large."})
        payload = _payload(body)
        if payload is None:
            return self._json(400, {"error": "The request could not be read."})
        kind = "scan" if path.endswith("/scan") else "update"
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
        return self._json(status, result)

    def _panel_update(self):
        if self.installer is None:
            return self._json(400, {"error": "This copy cannot install a release."})
        try:
            result = self.installer(self.config)
        except UpdateError as exc:
            return self._json(400, {"error": str(exc)})
        status = 200 if result.get("status") == "current" else 202
        return self._json(status, result)

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
        now = time.monotonic()
        with self._lock:
            expiry = self._sessions.get(token)
            if not expiry or expiry < now:
                self._sessions.pop(token, None)
                return False
            return True

    def _login(self, body):
        now = time.monotonic()
        if now < self._locked_until:
            return self._json(429, {"error": "Too many attempts. Wait a minute."})
        payload = _payload(body)
        password = ""
        if isinstance(payload, dict) and isinstance(payload.get("password"), str):
            password = payload["password"]
        if not verify_password(password, self.config.get("password_hash") or ""):
            self._failures += 1
            if self._failures >= 5:
                self._locked_until = now + 60
                self._failures = 0
            return self._json(401, {"error": "The password does not match."})
        self._failures = 0
        token = new_session()
        with self._lock:
            self._sessions[token] = now + 12 * 60 * 60
        return 204, {
            "Cache-Control": "no-store",
            "Set-Cookie": set_cookie(token),
        }, b""

    def _logout(self):
        return 204, {"Cache-Control": "no-store", "Set-Cookie": clear_cookie()}, b""


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


def serve(config, provider=None, assets=None):
    panel = Panel(
        config,
        provider or (lambda: collect_snapshot(config)),
        assets or assets_from_runtime(),
        releases=lambda cfg: describe(cfg),
        installer=lambda cfg: install_release(cfg, wait=False),
    )
    server = ThreadingHTTPServer((config["bind_host"], config["bind_port"]), make_handler(panel))
    server.serve_forever()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Homelab master control panel")
    parser.add_argument("--config")
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args(argv)
    if args.update:
        return _update(args.config)
    if not args.config:
        raise SystemExit("--config is required")
    try:
        config = load_config(args.config)
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    if not config.get("password_hash"):
        raise SystemExit("config needs a password_hash")
    serve(config)


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
