"""Pure readings for boot order, monitors, disks, and attention.

Nothing here opens a socket or starts a process.
"""

from __future__ import annotations

import calendar
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


_ON_CALENDAR = re.compile(r"OnCalendar=([^;}\n]+)")
_DAILY = re.compile(r"^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\*-\*-\*\s+(\d{2}):(\d{2}):(\d{2})$")
_DELAY = re.compile(r"RandomizedDelayUSec=([^\s;]+)")
_DELAY_TOKEN = re.compile(r"^(\d+)(h|min|s)?$")
_WEEKDAY = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}
HOUSE_CALENDAR = (
    ("homelab-scan.timer", "Scan"),
    ("homelab-update.timer", "Update"),
    ("pve-daily-update.timer", "Proxmox"),
)
DISK_LINE = "Disk check runs every two minutes."


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
        row = {"name": name, "type": kind or "unknown", "status": status, "at": when}
        if len(parts) > 4:
            row["uptime_24h"] = _kuma_percent(parts[4])
            row["uptime_7d"] = _kuma_percent(parts[5]) if len(parts) > 5 else None
            row["last_down"] = parts[6].strip() if len(parts) > 6 else ""
        rows.append(row)
    return rows


def _kuma_percent(raw):
    text = str(raw or "").strip().rstrip("%").strip()
    if not text or "://" in text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if value < 0 or value > 100:
        return None
    return value


def parse_on_calendar(text):
    """Recurrence rules from a TimersCalendar value. Unknown expressions are skipped."""
    return [{key: rule[key] for key in ("time", "weekdays")} for rule in _calendar_rules(text)]


def randomized_delay_seconds(text):
    """Seconds from a RandomizedDelayUSec show value. Bare integers are microseconds."""
    if not isinstance(text, str):
        return 0
    found = _DELAY.search(text)
    if not found:
        return 0
    match = _DELAY_TOKEN.fullmatch(found.group(1))
    if not match:
        return 0
    number = int(match.group(1))
    unit = match.group(2)
    if unit == "h":
        return number * 3600
    if unit == "min":
        return number * 60
    if unit == "s":
        return number
    return number // 1_000_000


def _calendar_rules(text):
    if not isinstance(text, str):
        return []
    chunks = _ON_CALENDAR.findall(text)
    if not chunks and text.strip() and "RandomizedDelayUSec=" not in text:
        chunks = [text.strip()]
    delay = randomized_delay_seconds(text)
    rules = []
    for chunk in chunks:
        match = _DAILY.fullmatch(chunk.strip())
        if not match:
            continue
        hour, minute, second = int(match.group(2)), int(match.group(3)), int(match.group(4))
        if hour > 23 or minute > 59 or second > 59:
            continue
        weekday = match.group(1)
        rule = {
            "time": f"{hour:02d}:{minute:02d}",
            "weekdays": None if weekday is None else [_WEEKDAY[weekday]],
        }
        until = _until_hhmm(hour, minute, second, delay)
        if until:
            rule["until"] = until
        rules.append(rule)
    return rules


def _until_hhmm(hour, minute, second, delay_seconds):
    if delay_seconds <= 0:
        return None
    total = hour * 3600 + minute * 60 + second + delay_seconds
    if total >= 24 * 3600:
        return "23:59"
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}"


def house_calendar(readings, present=()):
    """House jobs only. Housekeeping units are ignored. das-health stays a standing line."""
    source = readings if isinstance(readings, dict) else {}
    rules = []
    for unit, label in HOUSE_CALENDAR:
        for rule in _calendar_rules(source.get(unit) or ""):
            item = {"label": label, "time": rule["time"], "weekdays": rule["weekdays"]}
            if rule.get("until"):
                item["until"] = rule["until"]
            rules.append(item)
    units = set()
    for item in present or []:
        unit = item.get("unit") if isinstance(item, dict) else item
        if unit:
            units.add(str(unit))
    standing = [DISK_LINE] if "das-health.timer" in units else []
    return {"rules": rules, "standing": standing}


def expand_month(rules, year, month):
    """Occurrences inside one calendar month. weekdays use Monday=0 .. Sunday=6."""
    if not isinstance(year, int) or not isinstance(month, int) or month < 1 or month > 12:
        return []
    last = calendar.monthrange(year, month)[1]
    found = []
    for day in range(1, last + 1):
        current = datetime.date(year, month, day)
        for rule in rules or []:
            if not isinstance(rule, dict):
                continue
            days = rule.get("weekdays")
            if days is not None and current.weekday() not in days:
                continue
            found.append(
                {
                    "date": current.isoformat(),
                    "label": str(rule.get("label") or ""),
                    "time": str(rule.get("time") or ""),
                }
            )
    return found


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
