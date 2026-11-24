"""Local panel state. Secrets never go in these files."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path


def state_dir(config):
    raw = str((config or {}).get("state_dir") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        parent = Path(str(config.get("config_path") or ".")).parent
        path = parent / path
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


def load_checks(config):
    directory = state_dir(config)
    if directory is None:
        return None
    file = directory / "checks.json"
    try:
        payload = json.loads(file.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def save_checks(config, packages, guest_updates):
    directory = state_dir(config)
    if directory is None:
        return
    payload = {"packages": packages, "guest_updates": guest_updates}
    try:
        (directory / "checks.json").write_text(json.dumps(payload))
    except OSError:
        return


def load_sessions(config):
    directory = state_dir(config)
    if directory is None:
        return []
    try:
        payload = json.loads((directory / "sessions.json").read_text())
    except (OSError, json.JSONDecodeError):
        return []
    rows = payload.get("sessions") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    now = time.time()
    kept = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        token = row.get("token")
        expiry = row.get("expiry")
        if isinstance(token, str) and token and isinstance(expiry, (int, float)) and not isinstance(expiry, bool) and expiry > now:
            kept.append({"token": token, "expiry": float(expiry)})
    return kept


def save_sessions(config, sessions):
    directory = state_dir(config)
    if directory is None:
        return
    rows = []
    for row in sessions or []:
        if not isinstance(row, dict):
            continue
        token = row.get("token")
        expiry = row.get("expiry")
        if isinstance(token, str) and token and isinstance(expiry, (int, float)) and not isinstance(expiry, bool):
            rows.append({"token": token, "expiry": float(expiry)})
    file = directory / "sessions.json"
    payload = json.dumps({"sessions": rows}).encode()
    try:
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    except OSError:
        return
    try:
        os.write(fd, payload)
    except OSError:
        return
    finally:
        os.close(fd)
    try:
        os.chmod(file, 0o600)
    except OSError:
        return


def append_operator(config, action):
    directory = state_dir(config)
    if directory is None:
        return
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    line = f"{stamp} {action}\n"
    try:
        with (directory / "operator.log").open("a", encoding="utf-8") as handle:
            handle.write(line)
    except OSError:
        return


def read_operator(config, limit=20):
    directory = state_dir(config)
    if directory is None:
        return []
    try:
        lines = (directory / "operator.log").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    return [line for line in lines if line.strip()][-limit:]
