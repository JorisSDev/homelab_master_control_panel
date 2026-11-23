"""Turn collected host facts into the page model. The view does not shell out."""

from __future__ import annotations

import datetime
import re

from homelab_panel.parse_events import format_step, parse_events, steps_for_run
from homelab_panel.parse_logs import duration_between, parse_runs
from homelab_panel.parse_timers import format_when, parse_timers

STEP_NAMES = {
    "freshclam": "Virus definitions",
    "leftovers": "Leftover files",
    "clamav": "Malware scan",
    "apt": "Packages",
    "compose": "Compose apps",
    "health": "Health check",
    "security": "Security packages",
}

UNATTENDED_NOTE = (
    " unattended-upgrades is not installed, so this timer is not currently upgrading the host."
)
TRANSCRIPT_LIMIT = 250


def build_state(config, snapshot, now=None):
    clock = now or datetime.datetime.now().astimezone()
    timers = {row["unit"]: row for row in parse_timers(snapshot.get("timers") or [])}
    update_runs = parse_runs("update", snapshot.get("update_logs") or [])
    scan_runs = parse_runs("scan", snapshot.get("scan_logs") or [])
    events = parse_events(snapshot.get("event_logs") or [])
    _apply_event_steps(update_runs, events)
    _apply_event_steps(scan_runs, events)
    running = _running(snapshot)
    step = _current_step(events, {item["job"] for item in running})
    upgrades_active = "installed" in (snapshot.get("unattended_text") or "")
    return {
        "refresh_seconds": int(config.get("refresh_seconds") or 10),
        "now": _now(running, step, clock, update_runs, scan_runs),
        "schedule": _schedule(config, timers, upgrades_active),
        "history": {
            "update": [_run_view(run) for run in reversed(update_runs[-8:])],
            "scan": [_run_view(run) for run in reversed(scan_runs[-8:])],
        },
    }


def _apply_event_steps(runs, events):
    for index, run in enumerate(runs):
        following = runs[index + 1]["start"] if index + 1 < len(runs) else ""
        run["steps"] = steps_for_run(run, events, following)


def _running(snapshot):
    jobs = []
    if snapshot.get("scan_active"):
        jobs.append(
            {
                "job": "scan",
                "label": "daily scan",
                "since": snapshot.get("scan_since") or "just now",
                "started_us": snapshot.get("scan_started_us") or 0,
            }
        )
    if snapshot.get("update_active"):
        jobs.append(
            {
                "job": "update",
                "label": "weekly update",
                "since": snapshot.get("update_since") or "just now",
                "started_us": snapshot.get("update_started_us") or 0,
            }
        )
    return jobs


def _current_step(events, running_jobs):
    if not events or not running_jobs:
        return None
    for event in reversed(events):
        if event.get("job") in running_jobs and event.get("kind") == "step":
            return event
    return None


def _elapsed(started_us, clock):
    if not started_us:
        return ""
    seconds = started_us / 1_000_000 if started_us > 10_000_000_000 else started_us
    start = datetime.datetime.fromtimestamp(seconds).astimezone()
    return duration_between(start.isoformat(), clock.isoformat())


def _timeline(runs, job, step, elapsed):
    latest = runs[-1] if runs else None
    steps = list(latest["steps"]) if latest and not latest.get("end") else []
    guest = ""
    name = ""
    current_text = ""
    if step and step.get("job") == job:
        guest = step.get("guest") or "host"
        name = step.get("step") or "working"
        current_text = format_step(step)
        if current_text not in steps:
            steps.append(current_text)
    current_index = -1
    if current_text:
        for index, text in enumerate(steps):
            if text == current_text:
                current_index = index
    marked = []
    for index, text in enumerate(steps):
        current = index == current_index
        marked.append(
            {
                "text": _plain_step(text),
                "current": current,
                "guest": guest if current else "",
                "step": name if current else "",
                "elapsed": elapsed if current else "",
            }
        )
    return marked


def _plain_step(text):
    match = re.fullmatch(r"--\s+(\S+)\s+(\S+)\s+--", text or "")
    if not match:
        inner = (text or "").strip()
        if inner.startswith("--") and inner.endswith("--"):
            return inner.strip("-").strip()
        return inner
    guest, step = match.group(1), match.group(2)
    if step not in STEP_NAMES and guest in STEP_NAMES:
        guest, step = step, guest
    label = STEP_NAMES.get(step, step.replace("-", " "))
    where = "Host" if guest == "host" else f"Guest {guest}"
    return f"{where} · {label}"


def _activity(step):
    if not step:
        return "The job has started. The first check will appear here."
    guest = step.get("guest") or "host"
    name = step.get("step") or "working"
    label = STEP_NAMES.get(name, name.replace("-", " "))
    if guest == "host":
        return f"{label} on the host"
    return f"{label} on guest {guest}"


def _status(running):
    jobs = {item["job"] for item in running}
    if jobs == {"scan"}:
        return "Scan running"
    if jobs == {"update"}:
        return "Update running"
    return "Jobs running"


def _lock(running):
    jobs = {item["job"] for item in running}
    if jobs == {"scan"}:
        return "The scan is using the maintenance lock. The update waits until it finishes."
    if jobs == {"update"}:
        return "The update is using the maintenance lock. The scan waits until it finishes."
    return "Both jobs are active. They share one lock, so one of them is waiting."


def _clock(since):
    match = re.search(r"(\d{2}:\d{2})", since or "")
    return match.group(1) if match else ""


def _now(running, step, clock, update_runs, scan_runs):
    if not running:
        detail = "Nothing is running. The next scan and the next update are in the schedule."
        return {
            "idle": True,
            "status": "Idle",
            "detail": detail,
            "text": detail,
            "jobs": [],
            "step": None,
            "timeline": [],
            "waiting": False,
            "lock": "",
        }
    runs_for = {"update": update_runs, "scan": scan_runs}
    jobs = []
    timeline = []
    for item in running:
        elapsed = _elapsed(item["started_us"], clock)
        jobs.append(
            {
                "label": item["label"],
                "since": item["since"],
                "started": _clock(item["since"]),
                "elapsed": elapsed,
            }
        )
        timeline.extend(_timeline(runs_for[item["job"]], item["job"], step, elapsed))
    visible = None
    if step:
        visible = {
            "step": step.get("step") or "working",
            "guest": step.get("guest") or "host",
        }
    waiting = step is None
    return {
        "idle": False,
        "status": _status(running),
        "detail": _activity(step),
        "text": "",
        "jobs": jobs,
        "step": visible,
        "timeline": timeline,
        "waiting": waiting,
        "lock": _lock(running),
    }


def _schedule(config, timers, upgrades_active):
    featured = []
    names = []
    upgrade_unit = config.get("apt_daily_upgrade_unit") or ""
    for item in config.get("featured_timers") or []:
        unit = item.get("unit") or ""
        names.append(unit)
        row = timers.get(unit, {})
        note = item.get("note") or ""
        if unit == upgrade_unit and not upgrades_active:
            note += UNATTENDED_NOTE
        featured.append(
            {
                "unit": unit,
                "next": format_when(row.get("next"), "not scheduled"),
                "last": format_when(row.get("last"), "no run yet"),
                "note": note,
            }
        )
    housekeeping = []
    for unit, row in timers.items():
        if unit in names:
            continue
        housekeeping.append(
            {
                "unit": unit,
                "next": format_when(row.get("next"), "not scheduled"),
                "last": format_when(row.get("last"), "no run yet"),
            }
        )
    return {"featured": featured, "housekeeping": housekeeping}


def _run_view(run):
    heading = run["start"] or "unknown start"
    if run["dry"]:
        heading += " · dry run"
    if run["duration"]:
        heading += " · " + run["duration"]
    transcript = run["lines"]
    hidden = 0
    if len(transcript) > TRANSCRIPT_LIMIT:
        hidden = len(transcript) - TRANSCRIPT_LIMIT
        transcript = transcript[:TRANSCRIPT_LIMIT]
    return {
        "heading": heading,
        "ok": bool(run["ok"]),
        "result": run["result"],
        "steps": [_plain_step(step) for step in run["steps"]],
        "transcript": "\n".join(transcript),
        "hidden_lines": hidden,
    }

