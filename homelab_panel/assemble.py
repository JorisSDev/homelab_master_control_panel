"""Add the master-panel sections to a state dict. No host commands."""

from __future__ import annotations

from homelab_panel.identity import parse_identity, version_tuple
from homelab_panel.parse_logs import parse_runs
from homelab_panel.signals import blast_lines, house_calendar, signature_age_days, vzdump_has_job

TIMER_LABELS = {
    "homelab-scan.timer": "Daily scan",
    "homelab-update.timer": "Sunday update",
    "das-health.timer": "Disk check",
    "pve-daily-update.timer": "Proxmox package refresh",
    "apt-daily-upgrade.timer": "Debian upgrade timer",
    "apt-daily.timer": "Debian package lists",
    "fstrim.timer": "Weekly trim",
    "e2scrub_all.timer": "Sunday scrub",
    "xfs_scrub_all.timer": "Sunday scrub",
    "man-db.timer": "Manual database",
    "logrotate.timer": "Log rotate",
}


def extend_state(state, config, snapshot, now):
    _enrich_guests(state, config, snapshot)
    state["figures"] = _figures(state, snapshot, config)
    state["week"] = _week(state, snapshot, now)
    state["upcoming"] = [item for item in state["week"] if item["soon"]][:6]
    state["calendar"] = house_calendar(snapshot.get("calendars") or {}, snapshot.get("timers") or [])
    state["reach"] = _reach(config, snapshot, state)
    state["das"] = _das(config, snapshot, state)
    state["protection"] = _protection(config, snapshot, state)
    state["scan_meaning"] = _scan_meaning(config, snapshot, state, now)
    state["plex"] = _plex(config, snapshot)
    state["chronology"] = _chronology(snapshot, state)
    state["recovery"] = _recovery(state, snapshot, now)
    state["operator"] = list(snapshot.get("operator") or [])
    state["uptime_seconds"] = snapshot.get("uptime_seconds")
    state["attention"] = _attention(state)
    return state


def _enrich_guests(state, config, snapshot):
    by_id = {str(item.get("id") or ""): item for item in snapshot.get("guests") or []}
    roles = {str(key): str(value) for key, value in (config.get("roles") or {}).items()}
    rows = []
    for row in state["services"]["rows"]:
        guest = by_id.get(row["id"], {})
        order = guest.get("order")
        row["address"] = guest.get("address") or ""
        row["order"] = order if isinstance(order, int) else None
        row["onboot"] = bool(guest.get("onboot"))
        row["up"] = guest.get("up") if isinstance(guest.get("up"), int) else None
        row["mounts"] = [str(item) for item in guest.get("mounts") or []]
        row["nameservers"] = [str(item) for item in guest.get("nameservers") or []]
        row["role"] = roles.get(row["id"], "")
        row["blast"] = []
        rows.append(row)
    rows.sort(key=_boot_key)
    for row in rows:
        row["blast"] = blast_lines(row, rows)
    state["services"]["rows"] = rows


def _boot_key(row):
    order = row.get("order")
    ident = int(row["id"]) if str(row["id"]).isdigit() else 9999
    if isinstance(order, int):
        return (0, order, ident)
    return (1, ident, ident)


def _figures(state, snapshot, config):
    host = snapshot.get("host") or {}
    assigned = 0
    for guest in snapshot.get("guests") or []:
        if guest.get("status") == "running" and isinstance(guest.get("maxmem"), int):
            assigned += guest["maxmem"]
    mount = str((config.get("das") or {}).get("mount") or "/mnt/storage")
    das = next((row for row in state["storage"]["rows"] if row["label"] == mount), None)
    return {
        "load": (state.get("health") or {}).get("load") or "",
        "memory_used": (state.get("health") or {}).get("memory_used") or "",
        "memory_total": (state.get("health") or {}).get("memory_total") or "",
        "memory_assigned": _size(assigned),
        "root_free": (state.get("health") or {}).get("disk_free") or "",
        "root_total": (state.get("health") or {}).get("disk_total") or "",
        "das_free": das["free"] if das else "",
        "das_total": das["total"] if das else "",
        "das_label": mount,
    }


def _size(value):
    number = int(value or 0)
    if number <= 0:
        return ""
    gib = number / (1024 ** 3)
    if gib >= 1:
        return f"{gib:.1f} GB"
    return f"{number / (1024 ** 2):.0f} MB"


def _week(state, snapshot, now):
    from homelab_panel.parse_timers import format_when, parse_timers

    parsed = {row["unit"]: row for row in parse_timers(snapshot.get("timers") or [])}
    units = list(parsed) or ["homelab-scan.timer", "homelab-update.timer"]
    horizon = 48 * 3600
    items = []
    for unit in units:
        moment = (parsed.get(unit) or {}).get("next")
        soon = False
        if moment is not None and now is not None:
            soon = 0 <= (moment - now).total_seconds() <= horizon
        label = TIMER_LABELS.get(unit, unit.removesuffix(".timer").replace("-", " "))
        fallback = ""
        if unit == "homelab-scan.timer":
            fallback = state["scan"].get("next") or ""
        elif unit == "homelab-update.timer":
            fallback = state["update"].get("next") or ""
        items.append(
            {
                "unit": unit,
                "label": label,
                "next": format_when(moment, fallback or "not scheduled"),
                "soon": soon,
            }
        )
    items.sort(key=lambda item: (not item["soon"], item["next"]))
    return items


def _reach(config, snapshot, state):
    kuma = snapshot.get("kuma") or {"ok": False, "error": "Kuma is not configured.", "rows": []}
    by_name = {row["name"].lower(): row for row in kuma.get("rows") or []}
    probes = snapshot.get("probes") or {}
    paths = []
    for item in config.get("paths") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        probe = probes.get(name) or {}
        monitor = by_name.get(name.lower())
        paths.append(
            {
                "name": name,
                "guest": str(item.get("guest") or ""),
                "lan": str(item.get("lan") or ""),
                "public": str(item.get("public") or ""),
                "lan_ok": probe.get("lan"),
                "public_ok": probe.get("public"),
                "kuma": monitor["status"] if monitor else "",
            }
        )
    pins = snapshot.get("pins") or {"checked": False, "rows": []}
    matched = [row for row in pins.get("rows") or [] if row.get("ok")]
    drifted = [row for row in pins.get("rows") or [] if not row.get("ok")]
    if not pins.get("checked"):
        pin_summary = "Not checked"
    elif not (pins.get("rows") or []):
        pin_summary = "No pins to check"
    elif drifted:
        pin_summary = f"{len(drifted)} pins drifted"
    else:
        pin_summary = f"{len(matched)} pins match"
    rows = kuma.get("rows") or []
    up = [row["name"] for row in rows if row.get("status") == "up"]
    down = [row["name"] for row in rows if row.get("status") == "down"]
    if kuma.get("error"):
        summary = kuma["error"]
    elif not rows:
        summary = "No monitors"
    else:
        summary = f"{len(up)} up, {len(down)} down"
    wan = config.get("wan") or {}
    tunnel = snapshot.get("tunnel") or {}
    return {
        "paths": paths,
        "monitors": {"ok": bool(kuma.get("ok")), "error": kuma.get("error") or "", "summary": summary, "rows": rows},
        "kuma_url": _kuma_url(config),
        "pins": {"checked": bool(pins.get("checked")), "summary": pin_summary, "rows": pins.get("rows") or []},
        "multicast_snooping": snapshot.get("multicast_snooping"),
        "tunnel": {
            "guest": str((config.get("tunnel") or {}).get("guest_id") or ""),
            "connections": tunnel.get("connections"),
            "detail": tunnel.get("detail") or "",
        },
        "wan": {
            "port": wan.get("port") or "",
            "guest": str(wan.get("guest_id") or ""),
            "listening": snapshot.get("wan_listening"),
        },
    }


def _kuma_url(config):
    text = str(((config.get("kuma") or {}).get("url")) or "").strip()
    if text.startswith("https://") or text.startswith("http://"):
        return text
    return ""


def _das(config, snapshot, state):
    raw = snapshot.get("das") or {}
    expected = str(raw.get("expected_uuid") or (config.get("das") or {}).get("uuid") or "").lower()
    mounted = str(raw.get("mounted_uuid") or "")
    speeds = raw.get("speeds") or []
    faults = int(raw.get("faults") or 0)
    monitor_name = str((config.get("das") or {}).get("monitor") or "")
    smart = ""
    for row in ((snapshot.get("kuma") or {}).get("rows") or []):
        if monitor_name and row.get("name") == monitor_name:
            smart = row.get("status") or ""
    if expected and mounted:
        match = "Match" if expected == mounted else "Different disk"
        headline = "The shelf is the expected disk." if match == "Match" else "The mounted disk is not the expected disk."
    elif expected:
        match = "Not mounted"
        headline = "The expected disk is not mounted."
    elif mounted:
        match = "No expected disk"
        headline = "The shelf is mounted."
    else:
        match = "No expected disk"
        headline = "The shelf was not identified."
    return {
        "expected_uuid": expected,
        "mounted_uuid": mounted,
        "speeds": speeds,
        "faults": faults,
        "recent": raw.get("recent") or [],
        "smart": smart,
        "fstab_waits": raw.get("fstab_waits"),
        "summary": headline,
        "match": match,
    }


def _protection(config, snapshot, state):
    has_job = vzdump_has_job(snapshot.get("vzdump_text") or "")
    notes = {str(item.get("id")): str(item.get("note") or "") for item in config.get("single_copy") or [] if isinstance(item, dict)}
    rows = []
    for guest in state["services"]["rows"]:
        rows.append(
            {
                "name": guest["name"],
                "id": guest["id"],
                "backup": "Scheduled" if has_job else "No job",
                "snapshot": "None",
                "copy": notes.get(guest["id"]) or "",
            }
        )
    mount = str((config.get("das") or {}).get("mount") or "")
    if mount:
        rows.append({"name": mount, "id": "", "backup": "Scheduled" if has_job else "No job", "snapshot": "None", "copy": ""})
    return {"has_job": has_job, "rows": rows}


def _scan_meaning(config, snapshot, state, now):
    coverage = [str(item) for item in config.get("scan_coverage") or [] if str(item).strip()]
    age = signature_age_days(snapshot.get("signature_mtime"), now)
    if age is None:
        signature = ""
    elif age < 1:
        signature = "Signatures are under a day old"
    else:
        signature = f"Signatures are {int(age)} days old"
    streaks = []
    runs = parse_runs("scan", snapshot.get("scan_logs") or [])
    counts = {}
    for run in runs:
        if run.get("ok"):
            continue
        label = run.get("result") or "finding"
        counts[label] = counts.get(label, 0) + 1
    for label, count in counts.items():
        if count > 1:
            streaks.append({"text": label, "count": count})
    return {"coverage": coverage, "signature": signature, "signature_days": age, "streaks": streaks}


def _plex(config, snapshot):
    plex = config.get("plex") or {}
    parsed = parse_identity(snapshot.get("plex_xml") or "")
    minimum = str(plex.get("minimum_version") or "")
    version = parsed.get("version") or ""
    claimed = parsed.get("claimed") or ""
    meets = True
    if version and minimum:
        meets = version_tuple(version) >= version_tuple(minimum)
    ok = True
    if version or claimed:
        ok = claimed == "1" and meets
    render = snapshot.get("render") or "unknown"
    if render == "missing":
        ok = False
    return {
        "id": str(plex.get("guest_id") or ""),
        "version": version,
        "claimed": claimed,
        "minimum": minimum,
        "ok": ok,
        "render": render,
    }


def _chronology(snapshot, state):
    items = []
    for task in snapshot.get("tasks") or []:
        items.append({"text": task.get("text") or "task", "href": task.get("href") or "/guests"})
    for kind, href in (("scan", "/jobs/scan"), ("update", "/jobs/update")):
        history = (state.get(kind) or {}).get("history") or []
        if history:
            items.append({"text": f"{kind.title()} {history[0].get('heading') or ''}", "href": href})
    return items[:5]


def _recovery(state, snapshot, now):
    das = state["das"]
    rows = state["services"]["rows"]
    mount = str((state["figures"] or {}).get("das_label") or "")
    first = next((row for row in rows if row.get("onboot") and isinstance(row.get("order"), int)), None)
    bound = [row for row in rows if mount and any(str(item).startswith(mount) for item in row.get("mounts") or [])]
    pins = state["reach"]["pins"]
    probes = state["reach"]["paths"]
    scan_ok = (state.get("findings") or {}).get("count", 0) == 0 and bool((state.get("scan") or {}).get("history"))
    return [
        {"id": "disk", "label": "The expected disk is mounted", "ok": _disk_ok(das), "detail": das.get("summary") or ""},
        {"id": "fstab", "label": "fstab waits for that disk", "ok": das.get("fstab_waits"), "detail": ""},
        {
            "id": "first",
            "label": "The first boot guest is running",
            "ok": None if first is None else first.get("status") == "Running",
            "detail": "" if first is None else first.get("name") or "",
        },
        {
            "id": "bound",
            "label": "Guests that bind the disk are running",
            "ok": None if not bound else all(row.get("status") == "Running" for row in bound),
            "detail": "",
        },
        {
            "id": "paths",
            "label": "LAN and public names answer",
            "ok": _paths_ok(probes),
            "detail": _path_detail(probes),
        },
        {"id": "scan", "label": "The last scan is clean", "ok": scan_ok if (state.get("scan") or {}).get("history") else None, "detail": (state.get("scan") or {}).get("detail") or ""},
    ]


def _disk_ok(das):
    if not das.get("expected_uuid"):
        return None
    if das.get("match") == "Match":
        return True
    return False


def _paths_ok(paths):
    checked = [row for row in paths if row.get("lan_ok") is not None or row.get("public_ok") is not None]
    if not checked:
        return None
    return all(row.get("lan_ok") is not False and row.get("public_ok") is not False for row in checked)


def _path_detail(paths):
    checked = [row for row in paths if row.get("lan_ok") is not None or row.get("public_ok") is not None]
    if not checked:
        return ""
    failed = [row.get("name") or "A path" for row in checked if row.get("lan_ok") is False or row.get("public_ok") is False]
    if not failed:
        return f"{len(checked)} paths answer"
    return f"{', '.join(failed)} did not answer"


def _attention(state):
    items = []
    for finding in (state.get("findings") or {}).get("items") or []:
        href = "/jobs/update" if finding.get("job") == "update" else "/jobs/scan"
        items.append({"severity": "down", "text": finding.get("result") or "A job failed", "href": href})
    if (state.get("storage") or {}).get("status") == "Low on disk":
        items.append({"severity": "attention", "text": state["storage"].get("summary") or "Low on disk", "href": "/storage"})
    if not state["protection"]["has_job"]:
        items.append({"severity": "attention", "text": "There is no backup job.", "href": "/storage"})
    for row in state["reach"]["monitors"].get("rows") or []:
        if row.get("status") == "down":
            items.append({"severity": "down", "text": f"{row.get('name')} is down", "href": "/reach"})
    if state["reach"]["monitors"].get("error") and state["reach"]["monitors"]["error"] != "Kuma is not configured.":
        items.append({"severity": "unknown", "text": state["reach"]["monitors"]["error"], "href": "/reach"})
    rows = state["services"]["rows"]
    boot = [row for row in rows if row.get("onboot") and isinstance(row.get("order"), int)]
    if boot and boot[0].get("status") == "Stopped":
        name = boot[0].get("name") or boot[0]["id"]
        items.append({"severity": "down", "text": f"{name} is stopped. It is first in the boot sequence.", "href": f"/guests/{boot[0]['id']}"})
    seen = {}
    for row in rows:
        address = row.get("address") or ""
        if address:
            seen.setdefault(address, []).append(row.get("name") or row["id"])
    for names in seen.values():
        if len(names) > 1:
            items.append({"severity": "attention", "text": f"{' and '.join(names)} share an address.", "href": "/guests"})
    for row in state["reach"]["pins"].get("rows") or []:
        if not row.get("ok"):
            items.append({"severity": "attention", "text": f"{row.get('name') or row.get('id')} left its DNS pin.", "href": "/reach"})
    if state["reach"].get("multicast_snooping") is True:
        items.append({"severity": "attention", "text": "Multicast snooping is on.", "href": "/reach"})
    if state["das"].get("match") == "Different disk":
        items.append({"severity": "down", "text": "The mounted disk is not the expected disk.", "href": "/storage"})
    elif state["das"].get("faults"):
        items.append({"severity": "attention", "text": f"{state['das']['faults']} disk bus errors.", "href": "/storage"})
    plex = state["plex"]
    if plex.get("render") == "missing" or (plex.get("version") and not plex.get("ok")):
        items.append({"severity": "attention", "text": "Plex identity needs a look.", "href": f"/guests/{plex['id']}" if plex.get("id") else "/guests"})
    age = state["scan_meaning"].get("signature_days")
    if isinstance(age, (int, float)) and age > 3:
        items.append({"severity": "attention", "text": state["scan_meaning"]["signature"], "href": "/jobs/scan"})
    if (state.get("health") or {}).get("status") == "Low on disk" and not any(item["href"] == "/storage" and "disk" in item["text"].lower() for item in items):
        items.append({"severity": "attention", "text": "The host disk is low.", "href": "/storage"})
    return items
