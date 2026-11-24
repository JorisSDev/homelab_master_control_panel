"""Host observations. Parsers live in signals and never call these commands."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

from homelab_panel.inventory import GUEST_ID
from homelab_panel.signals import parse_kernel_faults, parse_kuma_table, parse_mount_uuid, parse_usb_speeds

_CACHE = {}
KUMA_SCRIPT = """
import sqlite3, sys
path = "/opt/uptime-kuma/data/kuma.db"
try:
    con = sqlite3.connect("file:" + path + "?mode=ro", uri=True)
except Exception:
    sys.exit(1)
query = (
    "select m.name, m.type, "
    "(select case status when 1 then 'up' when 0 then 'down' when 2 then 'pending' "
    "when 3 then 'maintenance' else 'unknown' end from heartbeat h "
    "where h.monitor_id = m.id order by h.time desc limit 1), "
    "(select time from heartbeat h where h.monitor_id = m.id order by h.time desc limit 1) "
    "from monitor m order by m.name"
)
for name, kind, status, when in con.execute(query):
    print("%s\\t%s\\t%s\\t%s" % (name or "", kind or "", status or "unknown", "" if when is None else when))
"""


def _cached(key, seconds, build):
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < seconds:
        return hit[1]
    value = build()
    _CACHE[key] = (now, value)
    return value


def read_kuma(config, runner):
    guest = str(((config.get("kuma") or {}).get("guest_id")) or "").strip()
    if not guest:
        return {"ok": False, "error": "Kuma is not configured.", "rows": []}
    if not GUEST_ID.fullmatch(guest):
        return {"ok": False, "error": "Kuma is not configured.", "rows": []}

    def build():
        try:
            text = runner(
                ["pct", "exec", guest, "--", "python3", "-c", KUMA_SCRIPT],
                timeout=8,
            )
        except TypeError:
            text = runner(["pct", "exec", guest, "--", "python3", "-c", KUMA_SCRIPT])
        if not text:
            return {"ok": False, "error": "Monitors could not be read.", "rows": []}
        return {"ok": True, "error": "", "rows": parse_kuma_table(text)}

    return _cached(("kuma", guest), 30, build)


def read_das(config, runner, reader):
    spec = config.get("das") or {}
    mount = str(spec.get("mount") or "")
    expected = str(spec.get("uuid") or "").lower()

    def build():
        mounted = ""
        if mount:
            try:
                mounted = parse_mount_uuid(runner(["findmnt", "-n", "-o", "UUID", mount], timeout=8))
            except TypeError:
                mounted = parse_mount_uuid(runner(["findmnt", "-n", "-o", "UUID", mount]))
        try:
            kernel = runner(["journalctl", "-k", "-n", "200", "--no-pager"], timeout=8)
            usb = runner(["lsusb", "-t"], timeout=8)
        except TypeError:
            kernel = runner(["journalctl", "-k", "-n", "200", "--no-pager"])
            usb = runner(["lsusb", "-t"])
        faults = parse_kernel_faults(kernel or "")
        return {
            "expected_uuid": expected,
            "mounted_uuid": mounted,
            "speeds": parse_usb_speeds(usb or ""),
            "faults": faults["count"],
            "recent": faults["recent"],
            "fstab_waits": None,
        }

    if not mount and not expected:
        return {
            "expected_uuid": "",
            "mounted_uuid": "",
            "speeds": [],
            "faults": 0,
            "recent": [],
            "fstab_waits": None,
        }
    result = _cached(("das", mount, expected), 60, build)
    from homelab_panel.signals import fstab_waits

    result = dict(result)
    result["fstab_waits"] = fstab_waits(reader("/etc/fstab"), mount)
    return result


def read_tasks(runner):
    def build():
        try:
            raw = runner(["pvesh", "get", "/cluster/tasks", "--output-format", "json"], timeout=8)
        except TypeError:
            raw = runner(["pvesh", "get", "/cluster/tasks", "--output-format", "json"])
        if not raw:
            return []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return []
        from homelab_panel.signals import parse_task_rows

        return parse_task_rows(payload)

    return _cached("tasks", 30, build)


def read_uptime(reader):
    raw = reader("/proc/uptime")
    part = (raw or "").split()
    if not part:
        return None
    try:
        return int(float(part[0]))
    except ValueError:
        return None


def read_multicast(reader):
    raw = reader("/sys/class/net/vmbr0/bridge/multicast_snooping").strip()
    if raw not in {"0", "1"}:
        return None
    return raw == "1"


def read_signature_mtime(stat):
    for path in ("/var/lib/clamav/daily.cld", "/var/lib/clamav/daily.cvd"):
        try:
            return int(stat(path).st_mtime)
        except OSError:
            continue
    return None


def read_plex(config, fetch=None):
    plex = config.get("plex") or {}
    url = str(plex.get("identity_url") or "")
    if not url.startswith(("http://", "https://")):
        return ""
    if fetch is None:
        def fetch(target):
            with urllib.request.urlopen(target, timeout=2) as response:
                return response.read(4000).decode("utf-8", "replace")
    try:
        return fetch(url) or ""
    except (OSError, ValueError, urllib.error.URLError):
        return ""


def read_render(config, runner, guests):
    plex = config.get("plex") or {}
    guest = str(plex.get("guest_id") or "")
    if not GUEST_ID.fullmatch(guest):
        return "unknown"
    match = next((item for item in guests if str(item.get("id") or "") == guest), None)
    if not match or str(match.get("status") or "") != "running":
        return "unknown"

    def build():
        command = ["pct", "exec", guest, "--", "stat", "/dev/dri/renderD128"]
        try:
            text = runner(command, timeout=4)
        except TypeError:
            text = runner(command)
        if text:
            return "present"
        return "missing"

    return _cached(("render", guest), 60, build)


def read_tunnel(config, runner):
    guest = str(((config.get("tunnel") or {}).get("guest_id")) or "")
    if not GUEST_ID.fullmatch(guest):
        return {"connections": None, "detail": ""}

    def build():
        command = ["pct", "exec", guest, "--", "wget", "-qO-", "http://127.0.0.1:2000/metrics"]
        try:
            text = runner(command, timeout=4) or ""
        except TypeError:
            text = runner(command) or ""
        match = re.search(r"cloudflared_tunnel_ha_connections\s+(\d+)", text)
        if not match:
            return {"connections": None, "detail": "The tunnel metrics were not read."}
        return {"connections": int(match.group(1)), "detail": ""}

    return _cached(("tunnel", guest), 30, build)


def read_wan(config, runner):
    wan = config.get("wan") or {}
    guest = str(wan.get("guest_id") or "")
    port = str(wan.get("port") or "")
    if not GUEST_ID.fullmatch(guest) or not port.isdigit():
        return None

    def build():
        command = ["pct", "exec", guest, "--", "ss", "-lnt"]
        try:
            text = runner(command, timeout=4) or ""
        except TypeError:
            text = runner(command) or ""
        return f":{port}" in text

    return _cached(("wan", guest, port), 30, build)
