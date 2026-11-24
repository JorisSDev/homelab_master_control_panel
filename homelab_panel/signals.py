"""Pure readings for boot order, monitors, disks, and attention.

Nothing here opens a socket or starts a process.
"""

from __future__ import annotations

import datetime
import re

IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
STARTUP_ORDER = re.compile(r"order=(\d+)")
STARTUP_UP = re.compile(r"up=(\d+)")
FAULT = re.compile(r"reset|disconnect|read-only|emergency_ro|I/O error", re.IGNORECASE)
USB_SPEED = re.compile(r"(\d+)M")
SECRET = re.compile(r"(?i)(password|token|secret|machineIdentifier)\s*[:=]\s*\S+")


def parse_guest_conf(text):
    onboot = False
    order = None
    up = None
    nameservers = []
    mounts = []
    for raw in (text or "").splitlines():
        if ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "onboot":
            onboot = value == "1"
        elif key == "startup":
            found = STARTUP_ORDER.search(value)
            delay = STARTUP_UP.search(value)
            if found:
                order = int(found.group(1))
            if delay:
                up = int(delay.group(1))
        elif key == "nameserver":
            nameservers.extend(part for part in value.split() if part)
        elif key.startswith("mp"):
            host = value.split(",", 1)[0].strip()
            if host.startswith("/") and ".." not in host:
                mounts.append(host)
    return {
        "onboot": onboot,
        "order": order,
        "up": up,
        "nameservers": nameservers,
        "mounts": mounts,
    }


def parse_kuma_table(text):
    rows = []
    for raw in (text or "").splitlines():
        parts = raw.split("\t")
        if len(parts) < 3:
            continue
        name, kind, status = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not name:
            continue
        when = parts[3].strip() if len(parts) > 3 else ""
        if status not in {"up", "down", "pending", "maintenance", "unknown"}:
            status = "unknown"
        rows.append({"name": name, "type": kind or "unknown", "status": status, "at": when})
    return rows


def parse_usb_speeds(text):
    found = []
    for match in USB_SPEED.finditer(text or ""):
        mbps = int(match.group(1))
        if mbps < 480:
            continue
        label = f"{mbps / 1000:g} Gbps" if mbps >= 1000 else f"{mbps} Mbps"
        if label not in found:
            found.append(label)
    return found


def parse_kernel_faults(text):
    lines = []
    for raw in (text or "").splitlines():
        if FAULT.search(raw):
            lines.append(raw.strip()[:180])
    return {"count": len(lines), "recent": lines[-3:]}


def parse_mount_uuid(text):
    token = (text or "").strip().split()
    if not token:
        return ""
    candidate = token[0].strip()
    if re.fullmatch(r"[0-9a-fA-F-]{8,}", candidate):
        return candidate.lower()
    return ""


def fstab_waits(text, mount):
    if not mount:
        return None
    for raw in (text or "").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if mount in stripped.split():
            return "timeout" in stripped or "_netdev" in stripped
    return False


def vzdump_has_job(text):
    for raw in (text or "").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("PATH="):
            continue
        return True
    return False


def parse_resolv(text):
    found = []
    for raw in (text or "").splitlines():
        parts = raw.split()
        if len(parts) >= 2 and parts[0] == "nameserver":
            found.append(parts[1])
    return found


def pins_match(expected, live):
    wanted = [item for item in expected or [] if item]
    found = [item for item in live or [] if item]
    if not wanted:
        return True
    return found[: len(wanted)] == wanted


def blast_lines(guest, guests):
    lines = []
    order = guest.get("order")
    if isinstance(order, int):
        later = [
            other
            for other in guests
            if other.get("id") != guest.get("id") and isinstance(other.get("order"), int) and other["order"] > order
        ]
        if later:
            lines.append(f"Starts before {len(later)} later guests")
    for mount in guest.get("mounts") or []:
        shares = [
            other.get("name") or other.get("id")
            for other in guests
            if other.get("id") != guest.get("id") and mount in (other.get("mounts") or [])
        ]
        if shares:
            lines.append(f"Shares {mount} with {', '.join(shares)}")
    return lines


def parse_task_rows(payload):
    rows = payload if isinstance(payload, list) else []
    found = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or item.get("worker") or "task")
        status = str(item.get("status") or "")
        guest = str(item.get("id") or item.get("vmid") or "")
        text = kind if not guest else f"{kind} {guest}"
        if status:
            text = f"{text} {status}"
        found.append({"text": text, "href": "/guests"})
    return found[-8:]


def redact(text):
    cleaned = IPV4.sub("[address]", text or "")
    return SECRET.sub(r"\1=[redacted]", cleaned)


def report_text(state):
    lines = ["Master control panel", ""]
    panel = state.get("panel") or {}
    lines.append(f"Panel {panel.get('version') or 'unknown'}")
    attention = state.get("attention") or []
    lines.append("Attention" if attention else "The house is clear.")
    for item in attention:
        lines.append(f"- {item.get('text') or ''}")
    lines.append("")
    lines.append("Boot order")
    for row in (state.get("services") or {}).get("rows") or []:
        order = row.get("order")
        prefix = f"{order}. " if isinstance(order, int) else "- "
        lines.append(f"{prefix}{row.get('name') or row.get('id')} {row.get('status') or ''}".rstrip())
    lines.append("")
    monitors = (state.get("reach") or {}).get("monitors") or {}
    lines.append(monitors.get("summary") or "Monitors were not read.")
    for row in monitors.get("rows") or []:
        lines.append(f"- {row.get('name')} {row.get('status')}")
    scan = state.get("scan") or {}
    lines.append("")
    lines.append(f"Scan {scan.get('detail') or scan.get('status') or ''}")
    das = state.get("das") or {}
    lines.append(f"Disk {das.get('summary') or ''}")
    return redact("\n".join(lines).strip() + "\n")


def signature_age_days(mtime, now):
    if not mtime or now is None:
        return None
    try:
        moment = datetime.datetime.fromtimestamp(float(mtime), datetime.timezone.utc)
    except (TypeError, ValueError, OSError):
        return None
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    return (now - moment).total_seconds() / 86400
