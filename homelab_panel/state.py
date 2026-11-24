"""Turn collected host facts into the page model. The view does not shell out."""

from __future__ import annotations

import datetime
import re

from homelab_panel.assemble import extend_state
from homelab_panel.parse_events import format_step, parse_events, steps_for_run
from homelab_panel.parse_logs import duration_between, parse_runs
from homelab_panel.parse_timers import format_when, parse_timers
from homelab_panel.inventory import service_url, wanted_ids
from homelab_panel.self_update import current_version

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
    schedule = _schedule(config, timers, upgrades_active)
    update = _job("update", running, step, clock, update_runs, schedule)
    scan = _job("scan", running, step, clock, scan_runs, schedule)
    health = _health(snapshot, schedule)
    services = _services(config, snapshot.get("guests") or [])
    storage = _storage(snapshot)
    findings = _findings(scan_runs, update_runs)
    panel = {"version": current_version(), "latest": "", "update_available": False, "error": ""}
    packages = {
        "checked": False,
        "total": None,
        "security": None,
        "pending": None,
        "names": [],
        "upgrades": [],
        "error": "",
    }
    guest_updates = {"checked": False, "error": "", "rows": [], "active": ""}
    built = {
        "refresh_seconds": int(config.get("refresh_seconds") or 10),
        "update": update,
        "scan": scan,
        "health": health,
        "services": services,
        "storage": storage,
        "findings": findings,
        "packages": packages,
        "guest_updates": guest_updates,
        "panel": panel,
    }
    return extend_state(built, config, snapshot, clock)


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


def _job(kind, running, step, clock, runs, schedule):
    mine = next((item for item in running if item["job"] == kind), None)
    other = [item for item in running if item["job"] != kind]
    elapsed = _elapsed(mine["started_us"], clock) if mine else ""
    timeline = _timeline(runs, kind, step, elapsed) if mine else []
    history = [_run_view(run) for run in reversed(runs[-8:])]
    last = runs[-1] if runs else None
    timer = _timer_row(schedule, "homelab-update.timer" if kind == "update" else "homelab-scan.timer")
    if kind == "update":
        purpose = "Installs host packages and recreates Compose apps. It restarts playback."
        idle_status = "Idle"
    else:
        purpose = "Checks leftover files and runs ClamAV. It does not restart apps."
        idle_status = "Idle"
    if mine:
        status = "Update running" if kind == "update" else "Scan running"
        detail = _activity(step if step and step.get("job") == kind else None)
        summary = detail
    elif other:
        status = "Waiting"
        detail = _lock(running)
        summary = detail
    else:
        status = idle_status
        detail = _last_sentence(kind, last)
        summary = detail
    return {
        "purpose": purpose,
        "idle": mine is None,
        "status": status,
        "detail": detail,
        "summary": summary,
        "next": timer.get("next") or "not scheduled",
        "note": timer.get("note") or "",
        "started": _clock(mine["since"]) if mine else "",
        "elapsed": elapsed,
        "timeline": timeline,
        "waiting": bool(mine) and (step is None or step.get("job") != kind),
        "lock": _lock(running) if running else "",
        "history": history,
        "security": None if not last else last.get("security"),
        "pending": None if not last else last.get("pending"),
        "dry": bool(last and last.get("dry")),
        "last_result": "" if not last else last.get("result") or "",
    }


def _timer_row(schedule, unit):
    for row in schedule["featured"] + schedule["housekeeping"]:
        if row["unit"] == unit:
            return row
    return {}


def _last_sentence(kind, last):
    if not last:
        if kind == "update":
            return "No update report yet."
        return "No scan report yet."
    if kind == "update" and last.get("security") is not None:
        sentence = f"Last report: {last['result']}."
        sentence += f" {last['security']} Debian security packages."
        if last.get("pending") is not None:
            sentence += f" {last['pending']} other host packages stayed pending."
        return sentence
    return f"Last report: {last.get('result') or 'incomplete'}."


def _size(value):
    number = int(value or 0)
    if number <= 0:
        return ""
    gib = number / (1024 ** 3)
    if gib >= 1:
        return f"{gib:.1f} GB"
    return f"{number / (1024 ** 2):.0f} MB"


def _metric_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _amount(value):
    return _size(value) or "0 MB"


def _percent(value):
    number = _metric_value(value)
    if number is None or number < 0:
        return ""
    percent = number * 100
    nearest = round(percent)
    if abs(percent - nearest) < 0.05:
        return f"{nearest:.0f}%"
    return f"{percent:.1f}%"


def _usage_pair(guest, used_key, total_key):
    if used_key not in guest or total_key not in guest:
        return ""
    used = _metric_value(guest.get(used_key))
    total = _metric_value(guest.get(total_key))
    if used is None or total is None:
        return ""
    return f"{_amount(used)} / {_amount(total)}"


def _service_names(value):
    if not isinstance(value, list):
        return []
    names = []
    for item in value:
        text = str(item or "").strip()
        if text:
            names.append(text)
    return names


def _health(snapshot, schedule):
    host = snapshot.get("host") or {}
    load = str(host.get("load") or "")
    memory_used = _size(host.get("memory_used"))
    memory_total = _size(host.get("memory_total"))
    disk_free = _size(host.get("disk_free"))
    disk_total = _size(host.get("disk_total"))
    disk_timer = _timer_row(schedule, "das-health.timer")
    names = {"homelab-scan.timer", "homelab-update.timer", "das-health.timer"}
    housekeeping = [row for row in schedule["featured"] + schedule["housekeeping"] if row["unit"] not in names]
    if not any((load, memory_total, disk_total)):
        status = "Not reported"
        summary = "This copy cannot read the host."
    else:
        free = int(host.get("disk_free") or 0)
        total = int(host.get("disk_total") or 0)
        status = "Low on disk" if total and free / total < 0.1 else "All right"
        parts = []
        if load:
            parts.append(f"Load {load}")
        if memory_used and memory_total:
            parts.append(f"{memory_used} of {memory_total} memory in use")
        if disk_free and disk_total:
            parts.append(f"{disk_free} free of {disk_total}")
        summary = " · ".join(parts)
    return {
        "purpose": "Is the host itself all right.",
        "status": status,
        "summary": summary,
        "load": load,
        "memory_used": memory_used,
        "memory_total": memory_total,
        "disk_free": disk_free,
        "disk_total": disk_total,
        "disk_check": {
            "next": disk_timer.get("next") or "not scheduled",
            "last": disk_timer.get("last") or "no run yet",
        },
        "housekeeping": housekeeping,
    }


def _services(config, guests):
    links = {str(key): value for key, value in (config.get("guest_links") or {}).items()}
    vm = config.get("vm") or {}
    by_id = {str(guest.get("id") or ""): guest for guest in guests}
    ids = wanted_ids(config) or list(by_id)
    rows = []
    for guest_id in ids:
        guest = by_id.get(guest_id, {})
        raw = guest.get("status") or ""
        if raw == "running":
            label = "Running"
        elif raw in {"stopped", "shutdown"}:
            label = "Stopped"
        else:
            label = "Not reported"
        name = guest.get("name") or ""
        if not name and guest_id == str(vm.get("id") or ""):
            name = vm.get("name") or ""
        rows.append(
            {
                "id": guest_id,
                "name": name or f"Guest {guest_id}",
                "kind": guest.get("kind") or ("vm" if guest_id == str(vm.get("id") or "") else "container"),
                "status": label,
                "url": service_url(str(links.get(guest_id) or ""), guest.get("address") or ""),
                "services": _service_names(guest.get("services")),
                "cpu": _percent(guest["cpu"]) if "cpu" in guest else "",
                "memory": _usage_pair(guest, "mem", "maxmem"),
                "disk": _usage_pair(guest, "disk", "maxdisk"),
            }
        )
    running = sum(row["status"] == "Running" for row in rows)
    stopped = sum(row["status"] == "Stopped" for row in rows)
    if not rows:
        status, summary = "None", "No guests are configured."
    elif stopped:
        status, summary = "Needs a look", f"{stopped} stopped"
    elif running:
        status, summary = "Running", f"{running} running"
    else:
        status, summary = "Not reported", "The host did not report guest status."
    return {"purpose": "Configured guests and the services inside them.", "status": status, "summary": summary, "rows": rows}


def _storage(snapshot):
    rows = []
    for item in snapshot.get("mounts") or []:
        rows.append(_space_row(item.get("mount") or "/", item.get("free"), item.get("total"), "mount"))
    known = [row["free_bytes"] for row in rows]
    for item in snapshot.get("storages") or []:
        if item.get("kind") == "dir" and any(_close(item.get("free"), value) for value in known):
            continue
        label = item.get("label") or "storage"
        detail = item.get("detail") or ""
        if item.get("status") not in {"", "active"}:
            rows.append(
                {
                    "label": label,
                    "kind": item.get("kind") or "",
                    "free": "",
                    "total": "",
                    "free_bytes": 0,
                    "status": "Not mounted",
                    "low": False,
                    "detail": detail,
                }
            )
            continue
        rows.append(_space_row(label, item.get("free"), item.get("total"), item.get("kind") or "storage", detail))
    visible = [{key: value for key, value in row.items() if key != "free_bytes"} for row in rows]
    status, summary = _storage_summary(visible)
    return {
        "purpose": "Free space on the host, the disk shelf, and the guest disks.",
        "status": status,
        "summary": summary,
        "rows": visible,
    }


def _storage_summary(visible):
    if not visible:
        return "Not reported", "This copy cannot read the disks."
    low = [row["label"] for row in visible if row["low"]]
    if low:
        return "Low on disk", "Low on " + ", ".join(low)
    unmounted = [row["label"] for row in visible if row["status"] == "Not mounted"]
    mounted = [row for row in visible if row["status"] != "Not mounted"]
    if mounted:
        root = next((row for row in mounted if row["label"] == "/"), mounted[0])
        summary = f"{root['free']} free on {root['label']}" if root["free"] else "Space was reported."
        if unmounted:
            summary = f"{summary.rstrip('.')}. {_unmounted_sentence(unmounted)}"
        return "Room to spare", summary
    return "Not mounted", _unmounted_sentence(unmounted)


def _unmounted_sentence(names):
    if len(names) == 1:
        return f"{names[0]} is not mounted."
    return f"{', '.join(names)} are not mounted."


def _space_row(label, free, total, kind, detail=""):
    free_n = int(free or 0)
    total_n = int(total or 0)
    low = bool(total_n) and free_n / total_n < 0.1
    return {
        "label": label,
        "kind": kind,
        "free": _size(free_n),
        "total": _size(total_n),
        "free_bytes": free_n,
        "status": "Low" if low else "Room",
        "low": low,
        "detail": detail,
    }


def _close(left, right):
    if not left or not right:
        return False
    return abs(int(left) - int(right)) / max(int(left), int(right)) < 0.02


def _findings(scan_runs, update_runs):
    items = []
    for job, runs in (("scan", scan_runs), ("update", update_runs)):
        if not runs:
            continue
        last = runs[-1]
        if last.get("ok"):
            continue
        view = _run_view(last)
        items.append(
            {
                "job": job,
                "guest": _finding_guest(last),
                "result": last.get("result") or "failed",
                "heading": view["heading"],
                "transcript": view["transcript"],
                "hidden_lines": view["hidden_lines"],
            }
        )
    if not items:
        status, summary = "Clear", "The last scan and the last update were fine."
    elif len(items) == 1:
        status, summary = "1 finding", items[0]["result"]
    else:
        status, summary = f"{len(items)} findings", items[0]["result"]
    return {"purpose": "What the last scan or update left behind.", "status": status, "summary": summary, "count": len(items), "items": items}


def _finding_guest(run):
    blob = " ".join([run.get("result") or "", *(run.get("steps") or [])])
    match = re.search(r"\b(?:CT|VM|guest)\s+(\d+)\b", blob, re.IGNORECASE)
    if match:
        return match.group(1)
    if re.search(r"\bhost\b", run.get("result") or "", re.IGNORECASE):
        return "host"
    return ""


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


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _short_start(value):
    text = str(value or "").strip()
    if not text or ("T" not in text and " " not in text):
        return text
    candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.datetime.fromisoformat(candidate)
    except ValueError:
        return text
    month = _MONTHS[parsed.month - 1]
    return f"{parsed.day} {month} {parsed.year}, {parsed.hour:02d}:{parsed.minute:02d}"


def _run_view(run):
    heading = _short_start(run["start"]) or "unknown start"
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

