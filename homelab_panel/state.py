"""Turn collected host facts into the page model.

The view does not shell out. Pending package counts come from the last update
report. The sign-in sentence is included only when the server is unclaimed.
"""

from __future__ import annotations

import datetime
import re

from homelab_panel.identity import parse_identity, version_tuple
from homelab_panel.parse_events import parse_events, steps_for_run
from homelab_panel.parse_logs import duration_between, parse_runs
from homelab_panel.parse_timers import format_when, parse_timers

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
    plex = parse_identity(snapshot.get("plex_xml") or "")
    if not plex["version"]:
        plex["version"] = _plex_from_scan(scan_runs, config)
    upgrades_active = "installed" in (snapshot.get("unattended_text") or "")
    return {
        "refresh_seconds": int(config.get("refresh_seconds") or 10),
        "now": _now(snapshot, running, step, clock),
        "schedule": _schedule(config, timers, upgrades_active),
        "history": {
            "update": [_run_view(run) for run in reversed(update_runs[-8:])],
            "scan": [_run_view(run) for run in reversed(scan_runs[-8:])],
        },
        "unfinished": {
            "facts": _facts(config, snapshot, plex, update_runs),
            "guests": _guests(config, snapshot, update_runs, scan_runs),
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


def _now(snapshot, running, step, clock):
    if not running:
        return {
            "idle": True,
            "text": "Nothing is running. The next scan and the next update are in the schedule below.",
            "jobs": [],
            "step": None,
            "waiting": False,
            "lock": "",
        }
    jobs = []
    for item in running:
        jobs.append(
            {
                "label": item["label"],
                "since": item["since"],
                "elapsed": _elapsed(item["started_us"], clock),
            }
        )
    visible = None
    if step:
        visible = {
            "step": step.get("step") or "working",
            "guest": step.get("guest") or "host",
        }
    waiting = step is None
    if len(running) == 1:
        lock = "This job holds the maintenance lock, so the other job waits until it finishes."
    else:
        lock = "Both jobs are active. They share one lock, so one of them is waiting."
    return {
        "idle": False,
        "text": "",
        "jobs": jobs,
        "step": visible,
        "waiting": waiting,
        "lock": lock,
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
        "steps": list(run["steps"]),
        "transcript": "\n".join(transcript),
        "hidden_lines": hidden,
    }


def _plex_from_scan(scan_runs, config):
    guest = str((config.get("plex") or {}).get("guest_id") or "")
    for run in reversed(scan_runs):
        if run.get("plex") and (not guest or run.get("plex_guest") == guest):
            return run["plex"]
    return ""


def _facts(config, snapshot, plex, update_runs):
    facts = [_plex_fact(config, plex)]
    wan = config.get("wan_forward") or ""
    if wan:
        facts.append(wan)
    if "disabled" in (snapshot.get("firewall_text") or ""):
        facts.append("The host firewall is off.")
    else:
        facts.append("The host firewall is no longer reporting disabled.")
    if _vzdump_jobs(snapshot.get("vzdump_text") or ""):
        facts.append("A Proxmox backup schedule is present.")
    else:
        facts.append(config.get("no_vzdump") or "There is no vzdump job.")
    facts.append(_update_fact(update_runs))
    return facts


def _plex_fact(config, plex):
    plex_config = config.get("plex") or {}
    guest = plex_config.get("guest_id") or ""
    minimum = plex_config.get("minimum_version") or ""
    label = f"CT {guest}" if guest else "the media guest"
    version = plex.get("version") or ""
    if not version:
        return f"Plex on {label} did not answer the local identity check."
    sentence = f"Plex on {label} is {version}."
    if minimum:
        if version_tuple(version) >= version_tuple(minimum):
            sentence += f" That is newer than {minimum}."
        else:
            sentence += f" That is older than {minimum}."
    if plex.get("claimed") == "0":
        signin = plex_config.get("signin_url") or ""
        if signin:
            sentence += f" The server still needs a sign-in at {signin}."
    elif plex.get("claimed") != "1":
        sentence += " The claim state was not readable."
    return sentence


def _vzdump_jobs(text):
    jobs = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("PATH="):
            continue
        jobs.append(stripped)
    return jobs


def _update_fact(update_runs):
    if not update_runs:
        return "No update report yet. Sunday 06:00 is the first real run."
    last = update_runs[-1]
    if last["security"] is None:
        return "The last update did not leave a security-package count."
    pending_text = ""
    if last["pending"] is not None:
        pending_text = (
            f" {last['pending']} other host packages, including Proxmox and kernel packages, stay pending."
        )
    count = str(last["security"])
    if last["dry"]:
        return (
            "The last update was a dry run. It would apply "
            + count
            + " Debian security packages on Sunday."
            + pending_text
        )
    return "The last update reported " + count + " Debian security packages." + pending_text


def _guests(config, snapshot, update_runs, scan_runs):
    composed = set(str(item) for item in (config.get("compose_ids") or []))
    if update_runs:
        for line in update_runs[-1]["lines"]:
            match = re.search(r"CT (\d+) compose", line)
            if match:
                composed.add(match.group(1))
    links = {str(key): value for key, value in (config.get("guest_links") or {}).items()}
    rows = []
    for guest in snapshot.get("guests") or []:
        guest_id = str(guest.get("id") or "")
        if guest.get("kind") == "vm":
            kind = "vm"
        elif guest_id in composed:
            kind = "compose"
        else:
            kind = "apt"
        rows.append(
            {
                "id": guest_id,
                "name": guest.get("name") or "",
                "address": guest.get("address") or "",
                "kind": kind,
                "last_update": _guest_result(guest_id, update_runs, "update"),
                "last_scan": _guest_result(guest_id, scan_runs, "scan"),
                "href": _link_for(guest.get("address") or "", links.get(guest_id, "")),
            }
        )
    return rows


def _link_for(address, suffix):
    if not suffix or not re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", address):
        return ""
    return "http://" + address + suffix


def _guest_result(guest_id, runs, label):
    if not runs:
        return "no run yet"
    run = runs[-1]
    mentions = [
        line
        for line in run["lines"]
        if f"CT {guest_id}" in line or f"guest={guest_id}" in line
    ]
    problems = [line for line in mentions if line.startswith("ISSUE") or line.startswith("FAIL")]
    if problems:
        return problems[-1]
    if any(
        line.startswith(f"-- CT {guest_id} ") or line.startswith(f"-- clamav CT {guest_id}")
        for line in run["lines"]
    ):
        if run["dry"]:
            return "seen in dry run"
        return "clean" if run["ok"] else run["result"]
    if any(f"VM {guest_id}" in line for line in run["lines"]):
        if "did not answer" in "\n".join(run["lines"]):
            return "guest agent did not answer"
        return "clean" if run["ok"] else run["result"]
    return "not in last " + label
