"""One JSON object per line from the maintenance event file.

The writer does not add a schema version. Each object has ``ts``, ``job``, and
``kind``. ``guest``, ``step``, ``dry``, ``result``, ``detail``, and ``message``
appear only when that run recorded them.
"""

from __future__ import annotations

import datetime
import json


def parse_events(parts):
    events = []
    for part in parts:
        for line in (part or "").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)
    return events


def parse_ts(value):
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.datetime.fromisoformat(value)
    except ValueError:
        return None


def format_step(event):
    guest = event.get("guest") or "host"
    step = event.get("step") or "working"
    detail = event.get("detail") or ""
    line = f"-- {guest} {step}"
    if detail:
        line += f" {detail}"
    return line + " --"


def steps_for_run(run, events, following_start=""):
    start = parse_ts(run.get("start"))
    end = parse_ts(run.get("end"))
    following = parse_ts(following_start)
    matched = []
    for event in events:
        if event.get("job") != run.get("job") or event.get("kind") != "step":
            continue
        moment = parse_ts(event.get("ts"))
        if start is None or moment is None or moment < start:
            continue
        if end is not None and moment > end:
            continue
        if end is None and following is not None and moment >= following:
            continue
        matched.append(event)
    if not matched:
        return list(run.get("steps") or [])
    return [format_step(event) for event in matched]
