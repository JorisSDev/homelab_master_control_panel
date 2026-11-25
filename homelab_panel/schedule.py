"""Sunday update schedule.

Skip, move, and one extra run touch only homelab-update. Commands are argv
lists. The update script is not edited.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from homelab_panel.store import state_dir

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_UNSAFE = set("\n;&|$`<>\\\"'")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_FILE = "update-schedule.json"


def _safe(text):
    if not isinstance(text, str) or not text or any(char in _UNSAFE for char in text):
        return None
    return text


def parse_time(value):
    if _safe(value) is None or _TIME.fullmatch(value) is None:
        return None
    return value


def parse_day(value):
    if _safe(value) is None:
        return None
    match = _DATE.fullmatch(value)
    if match is None:
        return None
    year, month, day = (int(match.group(index)) for index in (1, 2, 3))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_weekday(value):
    if type(value) is not int or not 0 <= value <= 6:
        return None
    return value


def coming_weekday(weekday, today):
    delta = (weekday - today.weekday()) % 7
    return today + timedelta(days=delta)


def on_calendar(weekday, clock):
    return f"{WEEKDAYS[weekday]} *-*-* {clock}:00"


def timer_dropin(weekday, clock):
    return f"[Timer]\nOnCalendar=\nOnCalendar={on_calendar(weekday, clock)}\n"


def condition_dropin(executable, program, config_path):
    for part in (executable, program, config_path):
        if _safe(part) is None or not part.startswith("/"):
            return None
    return f"[Service]\nExecCondition={executable} {program} --update-due --config {config_path}\n"


def once_command(stamp):
    if _safe(stamp) is None:
        return None
    return [
        "systemd-run",
        "--on-calendar",
        stamp,
        "--unit",
        "homelab-update-once",
        "--collect",
        "systemctl",
        "start",
        "--no-block",
        "homelab-update.service",
    ]


def load_schedule(config):
    directory = state_dir(config)
    if directory is None:
        return {}
    try:
        payload = json.loads((directory / _FILE).read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def save_schedule(config, payload):
    directory = state_dir(config)
    if directory is None:
        return False
    file = directory / _FILE
    temporary = file.with_name(file.name + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, indent=2) + "\n")
        os.chmod(temporary, 0o644)
        os.replace(temporary, file)
    except OSError:
        return False
    return True


def update_due(config, today=None):
    """True when the Sunday service should run. A matching skip date stops it."""
    today = today or date.today()
    skipped = parse_day(str(load_schedule(config).get("skip") or ""))
    return skipped != today


def overlay_calendar(calendar, stored):
    weekly = stored.get("weekly") if isinstance(stored, dict) else None
    if not isinstance(weekly, dict):
        return calendar
    weekday = parse_weekday(weekly.get("weekday"))
    clock = parse_time(str(weekly.get("time") or ""))
    if weekday is None or clock is None:
        return calendar
    rules = []
    replaced = False
    for rule in calendar.get("rules") or []:
        if rule.get("label") == "Update":
            rules.append({"label": "Update", "time": clock, "weekdays": [weekday]})
            replaced = True
        else:
            rules.append(rule)
    if not replaced:
        rules.append({"label": "Update", "time": clock, "weekdays": [weekday]})
    return {"rules": rules, "standing": list(calendar.get("standing") or [])}


def public_schedule(stored):
    weekly = stored.get("weekly") if isinstance(stored, dict) else None
    clean = None
    if isinstance(weekly, dict) and parse_weekday(weekly.get("weekday")) is not None and parse_time(str(weekly.get("time") or "")):
        clean = {"weekday": weekly["weekday"], "time": weekly["time"]}
    skip = parse_day(str(stored.get("skip") or "")) if isinstance(stored, dict) else None
    once = parse_day(str(stored.get("once") or "")) if isinstance(stored, dict) else None
    once_time = parse_time(str(stored.get("once_time") or "")) if isinstance(stored, dict) else None
    return {
        "skip": skip.isoformat() if skip else "",
        "once": once.isoformat() if once else "",
        "once_time": once_time or "",
        "weekly": clean,
    }


def _dropin(root, unit):
    return Path(root) / "etc" / "systemd" / "system" / unit / "panel.conf"


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text)
    os.replace(temporary, path)


def _still_ahead(day, clock, today, now):
    now = now or datetime.now()
    if day > today:
        return True
    if day < today:
        return False
    hour, minute = (int(part) for part in clock.split(":", 1))
    return (hour, minute) > (now.hour, now.minute)


def apply_schedule(config, action, fields, runner, *, root=None, today=None, now=None, executable="/usr/bin/python3", program="/opt/homelab-panel/current/homelab-panel.pyz"):
    today = today or date.today()
    root = Path("/") if root is None else Path(root)
    if state_dir(config) is None:
        return 400, {"error": "The schedule cannot be saved."}
    stored = load_schedule(config)
    if action == "skip":
        weekday = parse_weekday(fields.get("weekday", 6))
        if weekday is None:
            return 400, {"error": "The schedule was not accepted."}
        text = condition_dropin(executable, program, str(config.get("config_path") or ""))
        if text is None:
            return 400, {"error": "The schedule was not accepted."}
        when = coming_weekday(weekday, today)
        stored["skip"] = when.isoformat()
        if not save_schedule(config, stored):
            return 400, {"error": "The schedule cannot be saved."}
        _write(_dropin(root, "homelab-update.service.d"), text)
        if runner(["systemctl", "daemon-reload"]) != 0:
            return 502, {"error": "The schedule was not applied."}
        return 202, {"skip": when.isoformat()}
    if action == "move":
        weekday = parse_weekday(fields.get("weekday"))
        clock = parse_time(str(fields.get("time") or ""))
        if weekday is None or clock is None:
            return 400, {"error": "The schedule was not accepted."}
        stored["weekly"] = {"weekday": weekday, "time": clock}
        if not save_schedule(config, stored):
            return 400, {"error": "The schedule cannot be saved."}
        _write(_dropin(root, "homelab-update.timer.d"), timer_dropin(weekday, clock))
        if runner(["systemctl", "daemon-reload"]) != 0:
            return 502, {"error": "The schedule was not applied."}
        return 202, {"weekly": stored["weekly"]}
    if action == "once":
        day = parse_day(str(fields.get("date") or ""))
        clock = parse_time(str(fields.get("time") or ""))
        if day is None or clock is None or not _still_ahead(day, clock, today, now):
            return 400, {"error": "The schedule was not accepted."}
        command = once_command(f"{day.isoformat()} {clock}:00")
        if command is None or runner(command) != 0:
            return 502, {"error": "The extra run was not scheduled."}
        stored["once"] = day.isoformat()
        stored["once_time"] = clock
        save_schedule(config, stored)
        return 202, {"once": day.isoformat(), "once_time": clock}
    if action == "restore":
        stored.pop("skip", None)
        if not save_schedule(config, stored):
            return 400, {"error": "The schedule cannot be saved."}
        return 202, {"skip": ""}
    return 400, {"error": "The schedule was not accepted."}
