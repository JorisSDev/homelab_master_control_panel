"""Read the host. Parsers never call these commands."""

from __future__ import annotations

import datetime
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

from homelab_panel.inventory import (
    docker_listed,
    parse_address,
    parse_guest_services,
    parse_guest_table,
    parse_mounts,
    parse_pvesm,
    parse_resources,
    wanted_ids,
)
from homelab_panel.observe import (
    read_das,
    read_kuma,
    read_multicast,
    read_plex,
    read_render,
    read_signature_mtime,
    read_tasks,
    read_tunnel,
    read_uptime,
    read_wan,
)
from homelab_panel.signals import parse_guest_conf

_SERVICE_CACHE = {}
_SERVICE_CACHE_SECONDS = 60
_GUEST_TIMEOUT = 4
_CALENDAR_CACHE = {}
_CALENDAR_CACHE_SECONDS = 60
_CALENDAR_UNITS = (
    "homelab-scan.timer",
    "homelab-update.timer",
    "pve-daily-update.timer",
)


def run(command, timeout=8):
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL, timeout=timeout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def collect_snapshot(config, runner=run, reader=read_text, note=None):
    timers_raw = runner(["systemctl", "list-timers", "--all", "--output=json", "--no-pager"])
    try:
        timers = json.loads(timers_raw) if timers_raw else []
    except json.JSONDecodeError:
        timers = []
    if not isinstance(timers, list):
        timers = []
    scan_service = (config.get("services") or {}).get("scan") or "homelab-scan.service"
    update_service = (config.get("services") or {}).get("update") or "homelab-update.service"
    scan_active, scan_since, scan_started = _service(runner, scan_service)
    update_active, update_since, update_started = _service(runner, update_service)
    logs = config.get("logs") or {}
    snapshot = {
        "timers": timers,
        "calendars": read_calendars(runner),
        "scan_active": scan_active,
        "scan_since": scan_since,
        "scan_started_us": scan_started,
        "update_active": update_active,
        "update_since": update_since,
        "update_started_us": update_started,
        "update_logs": [reader(path) for path in (logs.get("update") or [])],
        "scan_logs": [reader(path) for path in (logs.get("scan") or [])],
        "event_logs": [reader(path) for path in (config.get("events") or [])],
        "unattended_text": runner(["dpkg-query", "-W", "-f", "${Status}", "unattended-upgrades"]),
        "host": read_host(reader),
        "guests": read_guests(config, runner, reader),
        "mounts": read_mounts(reader),
        "storages": parse_pvesm(*_storage_reading(runner, note)),
        "vzdump_text": reader(config.get("vzdump_cron") or "/etc/pve/vzdump.cron"),
        "uptime_seconds": read_uptime(reader),
        "multicast_snooping": read_multicast(reader),
        "kuma": read_kuma(config, runner),
        "das": read_das(config, runner, reader),
        "tasks": read_tasks(runner),
        "plex_xml": read_plex(config),
        "signature_mtime": read_signature_mtime(lambda path: Path(path).stat()),
        "render": "unknown",
        "tunnel": read_tunnel(config, runner),
        "wan_listening": read_wan(config, runner),
    }
    snapshot["render"] = read_render(config, runner, snapshot["guests"])
    return snapshot


def read_guests(config, runner=run, reader=read_text):
    listed = parse_resources(
        runner(["pvesh", "get", "/cluster/resources", "--type", "vm", "--output-format", "json"])
    )
    if not listed:
        listed.update(parse_guest_table(runner(["pct", "list"]), "container"))
        listed.update(parse_guest_table(runner(["qm", "list"]), "vm"))
    if listed:
        guest_ids = sorted(listed, key=lambda value: int(value) if str(value).isdigit() else 0)
    else:
        guest_ids = wanted_ids(config)
    rows = []
    vm = config.get("vm") or {}
    for guest_id in guest_ids:
        info = listed.get(guest_id, {})
        conf = reader(f"/etc/pve/lxc/{guest_id}.conf") or reader(f"/etc/pve/qemu-server/{guest_id}.conf")
        name = info.get("name") or ""
        if guest_id == str(vm.get("id") or "") and vm.get("name"):
            name = name or vm["name"]
        kind = info.get("kind") or ("vm" if guest_id == str(vm.get("id") or "") else "container")
        status = info.get("status") or ""
        services = _guest_services(guest_id, runner) if status == "running" and kind == "container" else []
        boot = parse_guest_conf(conf)
        row = {
            "id": guest_id,
            "name": name or f"Guest {guest_id}",
            "status": status,
            "kind": kind,
            "address": parse_address(conf),
            "services": services,
            "onboot": boot["onboot"],
            "order": boot["order"],
            "up": boot["up"],
            "nameservers": boot["nameservers"],
            "mounts": boot["mounts"],
        }
        for key in ("cpu", "mem", "maxmem", "disk", "maxdisk"):
            if key in info and info[key] is not None:
                row[key] = info[key]
        rows.append(row)
    return rows


def _storage_reading(runner, note):
    command = ["pvesm", "status"]
    if note is not None:
        return runner(command) or "", note(command) or ""
    if runner is run:
        return _run_both(command)
    return runner(command) or "", ""


def _run_both(command, timeout=8):
    try:
        completed = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return "", ""
    return completed.stdout or "", completed.stderr or ""


def read_calendars(runner=run):
    if runner is not run:
        return _read_calendars(runner)
    now = time.monotonic()
    cached = _CALENDAR_CACHE.get("house")
    if cached and now - cached[0] < _CALENDAR_CACHE_SECONDS:
        return dict(cached[1])
    found = _read_calendars(runner)
    _CALENDAR_CACHE["house"] = (now, dict(found))
    return found


def _read_calendars(runner):
    found = {}
    for unit in _CALENDAR_UNITS:
        command = ["systemctl", "show", unit, "-p", "TimersCalendar", "-p", "RandomizedDelayUSec"]
        if runner is run:
            found[unit] = runner(command, timeout=8) or ""
        else:
            found[unit] = runner(command) or ""
    return found


def _guest_services(guest_id, runner):
    if runner is not run:
        return _read_guest_services(guest_id, runner)
    now = time.monotonic()
    cached = _SERVICE_CACHE.get(guest_id)
    if cached and now - cached[0] < _SERVICE_CACHE_SECONDS:
        return list(cached[1])
    services = _read_guest_services(guest_id, runner)
    _SERVICE_CACHE[guest_id] = (now, list(services))
    return list(services)


def _read_guest_services(guest_id, runner):
    units = _invoke(
        runner,
        [
            "pct",
            "exec",
            str(guest_id),
            "--",
            "systemctl",
            "list-units",
            "--type=service",
            "--state=running",
            "--no-legend",
            "--plain",
            "--no-pager",
        ],
    )
    if not units.strip():
        return []
    images = ""
    if docker_listed(units):
        images = _invoke(
            runner,
            ["pct", "exec", str(guest_id), "--", "docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
        )
    return parse_guest_services(units, images)


def _invoke(runner, command):
    if runner is run:
        return runner(command, timeout=_GUEST_TIMEOUT) or ""
    return runner(command) or ""


def read_mounts(reader=read_text, disk=shutil.disk_usage):
    rows = []
    for item in parse_mounts(reader("/proc/mounts")):
        try:
            usage = disk(item["mount"])
        except OSError:
            continue
        if item["mount"] != "/" and usage.total < 1024 ** 3:
            continue
        rows.append({"mount": item["mount"], "fstype": item["fstype"], "free": usage.free, "total": usage.total})
    return rows


def read_host(reader=read_text):
    meminfo = reader("/proc/meminfo")
    if not meminfo.strip():
        return {"load": "", "memory_used": 0, "memory_total": 0, "disk_free": 0, "disk_total": 0}
    load_text = reader("/proc/loadavg")
    load_parts = load_text.split()
    load = load_parts[0] if load_parts else ""
    memory = {}
    for line in meminfo.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parts = value.split()
        if parts and parts[0].isdigit():
            memory[key.strip()] = int(parts[0]) * 1024
    total = memory.get("MemTotal", 0)
    available = memory.get("MemAvailable", 0)
    used = max(total - available, 0) if total else 0
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        usage = None
    return {
        "load": load,
        "memory_used": used,
        "memory_total": total,
        "disk_free": 0 if usage is None else usage.free,
        "disk_total": 0 if usage is None else usage.total,
    }


def _service(runner, unit):
    raw = runner(
        [
            "systemctl",
            "show",
            unit,
            "-p",
            "ActiveState",
            "-p",
            "ExecMainStartTimestamp",
            "-p",
            "ExecMainStartTimestampUSec",
        ]
    )
    values = {}
    for line in raw.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip()
    since = values.get("ExecMainStartTimestamp") or ""
    if since in {"", "n/a"}:
        since = ""
    started = start_usec(values.get("ExecMainStartTimestampUSec") or "", since)
    return values.get("ActiveState") == "activating", since, started


def start_usec(raw, since):
    try:
        number = int(raw or "0")
    except ValueError:
        number = 0
    if number:
        return number
    match = re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})", since or "")
    if not match:
        return 0
    naive = datetime.datetime.strptime(f"{match.group(1)} {match.group(2)}", "%Y-%m-%d %H:%M:%S")
    zone = datetime.datetime.now().astimezone().tzinfo
    return int(naive.replace(tzinfo=zone).timestamp() * 1_000_000)
