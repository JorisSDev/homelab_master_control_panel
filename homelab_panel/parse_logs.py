"""Split maintenance logs into runs.

Runs are separated on ``=== homelab-<job> start``. Rotated logs are passed in
first so the older run stays first.
"""

from __future__ import annotations

import datetime
import re


def duration_between(start, end):
    if not start or not end:
        return ""
    try:
        opened = datetime.datetime.fromisoformat(start)
        closed = datetime.datetime.fromisoformat(end)
    except ValueError:
        return ""
    minutes = int((closed - opened).total_seconds() // 60)
    if minutes < 1:
        return "under a minute"
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60} min"


def parse_runs(job, parts):
    text = "\n".join(part for part in parts if part)
    runs = []
    current = None
    for line in text.splitlines():
        if line.startswith(f"=== homelab-{job} start"):
            if current:
                runs.append(current)
            current = {"job": job, "lines": [line]}
        elif current is not None:
            current["lines"].append(line)
    if current:
        runs.append(current)
    for run in runs:
        _finish(job, run)
    return runs


def _finish(job, run):
    text = "\n".join(run["lines"])
    run["text"] = text
    run["dry"] = "dry=1" in run["lines"][0]
    run["steps"] = [line for line in run["lines"] if line.startswith("-- ")]
    fail = next((line[5:].strip() for line in run["lines"] if line.startswith("FAIL ")), "")
    issues = [line[6:].strip() for line in run["lines"] if line.startswith("ISSUE ")]
    if fail:
        run["result"] = fail
        run["ok"] = False
    elif issues:
        run["result"] = "; ".join(issues[:4])
        run["ok"] = False
    elif "scan clean" in text or "homelab-update done" in text:
        if run["dry"]:
            run["result"] = "dry run"
        elif job == "scan":
            run["result"] = "clean"
        else:
            run["result"] = "finished"
        run["ok"] = True
    else:
        run["result"] = "incomplete"
        run["ok"] = False
    start = re.search(r"start (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)", run["lines"][0])
    end = re.search(r"(?:done|end) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)", text)
    run["start"] = start.group(1) if start else ""
    run["end"] = end.group(1) if end else ""
    run["duration"] = duration_between(run["start"], run["end"])
    security = re.search(r"Would upgrade (\d+) Debian security", text)
    pending = re.search(r"(\d+) non-security host packages left pending", text)
    run["security"] = int(security.group(1)) if security else None
    run["pending"] = int(pending.group(1)) if pending else None
    plex = re.search(r"CT (\d+) Plex (\S+)", text)
    run["plex_guest"] = plex.group(1) if plex else ""
    run["plex"] = plex.group(2) if plex else ""
