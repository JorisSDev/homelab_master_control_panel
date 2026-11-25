"""Review and execution state shared by the panel and the security timer."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import secrets
import socket
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from homelab_panel.maintenance_actions import (
    APT_TRUST, COMPONENT, MaintenanceError, app_plan, apply_app, apply_security, command,
    run_command, security_plan, verify_host,
)

PLAN_MINUTES = 30
FRESH_HOURS = 24
RECOVERY_FIELDS = {"reference", "backup_at", "restore_tested_at", "coverage", "target"}


def now_utc():
    return datetime.now(timezone.utc)


def timestamp(value):
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(timezone.utc) if result.tzinfo is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


def checked_now():
    return now_utc().isoformat(timespec="seconds")


def save_document(path, value):
    if path is None:
        raise MaintenanceError("A private state directory is required.")
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
            temporary = Path(out.name)
            json.dump(value, out)
            out.flush()
            os.fsync(out.fileno())
        temporary.replace(path)
    except OSError as exc:
        raise MaintenanceError("Maintenance state could not be saved.") from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_document(path, *, private=False):
    if path is None:
        return {}
    try:
        if private:
            info = path.stat()
            if info.st_uid != os.geteuid() or info.st_mode & 0o077 or path.is_symlink():
                return {}
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


class Maintenance:
    def __init__(self, config, run=run_command):
        settings = config.get("maintenance")
        self.settings = settings if isinstance(settings, dict) else {}
        apps = self.settings.get("apps")
        self.apps = {key: spec for key, spec in apps.items()
                     if COMPONENT.fullmatch(key) and key not in {"security", "automatic_check"}
                     and isinstance(spec, dict)} if isinstance(apps, dict) else {}
        raw_path = config.get("state_dir")
        directory = None if not raw_path else Path(raw_path)
        if directory is not None and not directory.is_absolute():
            directory = Path(config.get("config_path") or ".").parent / directory
        self.file = directory / "maintenance.json" if directory is not None else None
        self.receipts = directory / "recovery-evidence.json" if directory is not None else None
        self.lock_path = Path(self.settings.get("lock_file") or "/run/homelab-maintain.lock")
        self.run = run
        self.plans = {}
        self.guard = threading.Lock()
        self.active = False
        self.can_change = self.settings.get("enabled") is True and directory is not None and self.lock_path.is_absolute()

    @contextmanager
    def exclusive(self):
        if not self.can_change:
            raise MaintenanceError("The isolated maintenance workflow is disabled.")
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        except OSError as exc:
            raise MaintenanceError("The shared maintenance lock could not be opened.") from exc
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise MaintenanceError("Another maintenance job is active.") from exc
            yield fd
        finally:
            os.close(fd)

    def evidence(self, key):
        stored = read_document(self.receipts, private=True).get(key)
        if not isinstance(stored, dict) or not RECOVERY_FIELDS.issubset(stored):
            return None
        ref = stored["reference"]
        backup, tested = timestamp(stored["backup_at"]), timestamp(stored["restore_tested_at"])
        required = {"configuration", "system"} if key == "security" else {"configuration", "data", "database"}
        target = {"host": socket.gethostname().split(".")[0]} if key == "security" else {
            field: str(self.apps.get(key, {}).get(field, "")) for field in ("guest", "service", "compose_file")
        }
        scopes = stored["coverage"]
        now = now_utc()
        if (not isinstance(ref, str) or not ref.strip() or len(ref) > 160 or not backup or not tested
                or backup > now or tested > now or not isinstance(scopes, list) or not all(isinstance(x, str) for x in scopes)
                or not required.issubset(scopes) or target != stored["target"]):
            return None
        if stored.get("same_disk") is True:
            mount, uuid = stored.get("mountpoint"), stored.get("filesystem_uuid")
            if (not isinstance(mount, str) or not mount.startswith("/") or ".." in Path(mount).parts
                    or not isinstance(uuid, str) or not COMPONENT.fullmatch(uuid)):
                return None
        return {"reference": ref, "backup_at": backup.isoformat(), "restore_tested_at": tested.isoformat(),
                "fresh": now - backup <= timedelta(hours=FRESH_HOURS), "same_disk": stored.get("same_disk") is True}

    def _check_backup_mount(self, key):
        stored = read_document(self.receipts, private=True).get(key, {})
        if isinstance(stored, dict) and stored.get("same_disk") is True:
            mount, uuid = stored.get("mountpoint"), stored.get("filesystem_uuid")
            if not isinstance(mount, str) or not isinstance(uuid, str):
                raise MaintenanceError("The DAS backup evidence changed.")
            actual = command(self.run, ["findmnt", "-n", "-o", "UUID", "--mountpoint", stored["mountpoint"]],
                             "The DAS backup mount could not be verified.").strip()
            if actual != uuid:
                raise MaintenanceError("The recorded DAS backup filesystem is unavailable.")

    def _receipt_digest(self, key):
        data = read_document(self.receipts, private=True).get(key)
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

    def _blocker(self, key):
        if not self.can_change:
            return "Workflow disabled on this installation."
        previous = read_document(self.file, private=True).get(key, {})
        if isinstance(previous, dict) and previous.get("status") == "failed":
            return "The previous run needs operator review."
        if isinstance(previous, dict) and previous.get("status") == "running":
            return "A previous run has no recorded completion."
        evidence = self.evidence(key)
        if evidence is None:
            return "A backup and tested restore are required."
        if not evidence["fresh"]:
            return "The last backup is older than 24 hours."
        return ""

    def status(self, timer="", *, legacy_paused=None):
        document = read_document(self.file, private=True)
        def row(key, name):
            return {"id": key, "name": name, "blocker": self._blocker(key),
                    "can_preview": self.can_change, "backup": self.evidence(key), "last_run": document.get(key)}
        return {
            "security": {**row("security", "Host security"), "automation": timer or "unknown",
                         "automation_check": document.get("automatic_check")},
            "apps": [row(key, str(spec.get("name") or key)[:80]) for key, spec in self.apps.items()],
            "legacy_paused": legacy_paused,
            "active": self.active,
            "history": document.get("history", []),
        }

    def _known(self, key):
        if key != "security" and key not in self.apps:
            raise MaintenanceError("This application is not enrolled.")

    def _inspect(self, key):
        if key == "security":
            packages = security_plan(self.run)
            return {"packages": packages, "available": bool(packages)}
        return app_plan(self.run, self.apps[key])

    def preview(self, key):
        self._known(key)
        with self.exclusive():
            evidence = self.evidence(key)
            report = self._inspect(key)
            blocker = self._blocker(key)
            reviewed_at = now_utc()
            plan = {
                "id": secrets.token_hex(16), "target": key, "checked_at": reviewed_at.isoformat(),
                "expires_at": (reviewed_at + timedelta(minutes=PLAN_MINUTES)).isoformat(),
                "backup": evidence, "receipt_digest": self._receipt_digest(key), "blocker": blocker, **report,
            }
            with self.guard:
                self.plans[key] = plan
            return {k: v for k, v in plan.items() if k not in {"config_digest", "target_digest", "receipt_digest"}}

    def _save(self, key, row):
        current = read_document(self.file, private=True)
        if key == "security" and current.get(key, {}).get("supervised"):
            row = {**row, "supervised": True}
        current[key] = row
        if key != "automatic_check" and row["status"] in {"success", "failed", "blocked"}:
            current["history"] = [{"target": key, **row}, *current.get("history", [])][:30]
        save_document(self.file, current)

    def _previous_clear(self, key):
        previous = read_document(self.file, private=True).get(key, {})
        if previous.get("status") == "running":
            raise MaintenanceError("A prior run was interrupted. Review and reconcile it on the host.")
        if previous.get("status") == "failed":
            raise MaintenanceError("The previous run needs operator review on the host.")

    def _run(self, key, plan, lock_fd, *, mode):
        self._previous_clear(key)
        blocker = self._blocker(key)
        if blocker:
            raise MaintenanceError(blocker)
        if plan["receipt_digest"] != self._receipt_digest(key) or plan["backup"] != self.evidence(key):
            raise MaintenanceError("The backup evidence changed. Prepare a new review.")
        self._check_backup_mount(key)
        verify_host(self.run, idle=True)
        current = self._inspect(key)
        if not current["available"] or any(plan.get(k) != v for k, v in current.items()):
            raise MaintenanceError("The update changed. Prepare a new review.")
        if plan["receipt_digest"] != self._receipt_digest(key) or plan["backup"] != self.evidence(key):
            raise MaintenanceError("The backup evidence changed. Prepare a new review.")
        self._check_backup_mount(key)
        record = {"status": "running", "mode": mode, "at": checked_now(), "message": "Applying the reviewed changes."}
        if key == "security":
            record["supervised"] = mode == "manual" or bool(read_document(self.file, private=True).get(key, {}).get("supervised"))
        if key != "security":
            record["retained_image"] = f"homelab-rollback/{key}:{plan['id']}"
        self._save(key, record)
        try:
            if key == "security":
                apply_security(self.run, current["packages"], lock_fd)
                verify_host(self.run, idle=False)
                message = f"Installed {len(current['packages'])} reviewed host security packages."
            else:
                apply_app(self.run, key, self.apps[key], current, plan["id"], lock_fd)
                message = "The enrolled service is running the reviewed image and passed its health check."
        except Exception as exc:
            self._save(key, {**record, "status": "failed", "at": checked_now(), "message": (
                str(exc) if isinstance(exc, MaintenanceError) else "The update stopped unexpectedly. Review the host before retrying.")})
            raise MaintenanceError("The update stopped. Review the recorded outcome.") from exc
        self._save(key, {**record, "status": "success", "at": checked_now(), "message": message,
                         "reboot_required": key == "security" and Path("/run/reboot-required").exists()})

    def apply(self, key, token, finished=lambda: None):
        self._known(key)
        with self.guard:
            plan = self.plans.get(key)
            if not isinstance(token, str) or not plan or token != plan["id"] or timestamp(plan["expires_at"]) <= now_utc():
                raise MaintenanceError("This review expired or was already used. Prepare a new one.")
            if not plan["available"] or plan["blocker"]:
                raise MaintenanceError(plan["blocker"] or "There are no changes to apply.")
            if self.active:
                raise MaintenanceError("Another update is active.")
            lock = self.exclusive()
            fd = lock.__enter__()
            self.active = True
            del self.plans[key]

        def work():
            try:
                self._run(key, plan, fd, mode="manual")
            except MaintenanceError as exc:
                # A preflight denial has not started any install. Preserve prior failed evidence.
                prior = read_document(self.file, private=True).get(key, {})
                if prior.get("status") not in {"running", "failed"}:
                    try:
                        self._save(key, {"status": "blocked", "mode": "manual", "at": checked_now(), "message": str(exc)})
                    except MaintenanceError:
                        pass
            finally:
                lock.__exit__(None, None, None)
                with self.guard:
                    self.active = False
                finished()
        thread = threading.Thread(target=work, name="reviewed-maintenance", daemon=True)
        try:
            thread.start()
        except RuntimeError:
            lock.__exit__(None, None, None)
            with self.guard:
                self.active = False
            raise MaintenanceError("The update worker could not start.") from None

    def automatic_security(self):
        policy = self.settings.get("security_auto")
        if not isinstance(policy, dict) or policy.get("enabled") is not True:
            raise MaintenanceError("Host security automation is disabled.")
        allowed = policy.get("allow_packages")
        if not isinstance(allowed, list) or not allowed or not all(isinstance(x, str) for x in allowed):
            raise MaintenanceError("Approve an explicit package list before enabling automation.")
        with self.exclusive() as fd:
            prior = read_document(self.file, private=True).get("security", {})
            if not prior.get("supervised"):
                raise MaintenanceError("A supervised successful security run is required.")
            self._previous_clear("security")
            blocker = self._blocker("security")
            if blocker:
                raise MaintenanceError(blocker)
            verify_host(self.run, idle=True)
            command(self.run, ["apt-get", *APT_TRUST, "-o", "APT::Update::Error-Mode=any", "update"],
                    "APT could not refresh signed package lists.", timeout=180, lock_fd=fd)
            current = self._inspect("security")
            packages = current["packages"]
            if not packages:
                message = "No security candidates in the last check."
                self._save("automatic_check", {"at": checked_now(), "status": "success", "message": message})
                return message
            if any(item["critical"] or item["name"] not in allowed for item in packages):
                message = "Security candidates need manual review."
                self._save("automatic_check", {"at": checked_now(), "status": "blocked", "message": message})
                return message
            plan = {"id": secrets.token_hex(16), "backup": self.evidence("security"),
                    "receipt_digest": self._receipt_digest("security"), **current}
            self._run("security", plan, fd, mode="automatic")
            self._save("automatic_check", {"at": checked_now(), "status": "success", "message": "Approved host security packages verified."})
            return "Approved host security packages verified."
