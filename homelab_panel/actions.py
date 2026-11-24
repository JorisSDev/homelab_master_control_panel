"""Start a maintenance job.

The update starts only after the page sends an explicit confirmation. Nothing
else on the host is started or stopped.
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


def start_action(config, kind, confirmed, snapshot, starter):
    if snapshot.get("scan_active") or snapshot.get("update_active"):
        return 400, {"error": "A job is already running."}, False
    if kind == "disk":
        unit = str(config.get("disk_unit") or "")
        if not UNIT.fullmatch(unit):
            return 400, {"error": "The disk check is not configured."}, False
        code = starter(["systemctl", "start", "--no-block", unit])
        if code != 0:
            return 502, {"error": "The job did not start."}, False
        return 202, {"started": kind}, True
    unit = unit_name(config, kind)
    if not unit:
        return 400, {"error": "The job is not configured."}, False
    if kind == "update" and confirmed is not True:
        return 400, {"error": "The update was not confirmed."}, False
    code = starter(["systemctl", "start", "--no-block", unit])
    if code != 0:
        return 502, {"error": "The job did not start."}, False
    return 202, {"started": kind}, True
