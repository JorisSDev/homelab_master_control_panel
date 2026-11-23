"""Start a maintenance job. The update starts only when the phrase matches.

The phrase is a confirmation that names the restart. It is not a password.
Nothing else on the host is started or stopped.
"""

from __future__ import annotations

import re
import subprocess

UNIT = re.compile(r"^[A-Za-z0-9@._-]+$")


def start_unit(command):
    try:
        completed = subprocess.run(command, timeout=8, check=False)
    except (subprocess.TimeoutExpired, OSError):
        return 1
    return completed.returncode


def unit_name(config, kind):
    named = config.get("scan_unit" if kind == "scan" else "update_unit") or ""
    if not named:
        named = (config.get("services") or {}).get(kind) or ""
    if not UNIT.fullmatch(named):
        return ""
    return named


def start_action(config, kind, confirmation, snapshot, starter):
    if snapshot.get("scan_active") or snapshot.get("update_active"):
        return 400, {"error": "A maintenance job is already running."}, False
    unit = unit_name(config, kind)
    if not unit:
        return 400, {"error": "The job is not configured."}, False
    if kind == "update":
        phrase = config.get("update_confirmation") or ""
        if not phrase or confirmation != phrase:
            return 400, {"error": "The confirmation does not match."}, False
    code = starter(["systemctl", "start", "--no-block", unit])
    if code != 0:
        return 502, {"error": "The job did not start."}, False
    return 202, {"started": kind}, True
