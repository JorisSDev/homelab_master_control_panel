"""Read the host. Parsers never call these commands."""

from __future__ import annotations

import json
import re
import subprocess


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


def collect_snapshot(config, runner=run, reader=read_text):
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
    plex = config.get("plex") or {}
    identity_url = plex.get("identity_url") or ""
    plex_xml = ""
    if identity_url:
        plex_xml = runner(["curl", "-sS", "--max-time", "3", identity_url])
    return {
        "timers": timers,
        "scan_active": scan_active,
        "scan_since": scan_since,
        "scan_started_us": scan_started,
        "update_active": update_active,
        "update_since": update_since,
        "update_started_us": update_started,
        "update_logs": [reader(path) for path in (logs.get("update") or [])],
        "scan_logs": [reader(path) for path in (logs.get("scan") or [])],
        "event_logs": [reader(path) for path in (config.get("events") or [])],
        "plex_xml": plex_xml,
        "firewall_text": runner(["pve-firewall", "status"]),
        "vzdump_text": reader(config.get("vzdump_cron") or ""),
        "unattended_text": runner(["dpkg-query", "-W", "-f", "${Status}", "unattended-upgrades"]),
        "guests": _guests(config, runner),
    }


def _service(runner, unit):
    state = runner(["systemctl", "show", unit, "-p", "ActiveState", "--value"]).strip()
    since = runner(["systemctl", "show", unit, "-p", "ExecMainStartTimestamp", "--value"]).strip()
    started = runner(["systemctl", "show", unit, "-p", "ActiveEnterTimestampUSec", "--value"]).strip()
    try:
        started_us = int(started or "0")
    except ValueError:
        started_us = 0
    return state == "activating", since, started_us


def _guests(config, runner):
    rows = []
    for line in runner(["pct", "list"]).splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        guest_id = parts[0]
        config_text = runner(["pct", "config", guest_id], timeout=5)
        match = re.search(r"ip=([0-9.]+)", config_text)
        rows.append(
            {
                "id": guest_id,
                "name": parts[-1],
                "status": parts[1],
                "address": match.group(1) if match else "",
                "kind": "container",
            }
        )
    vm = config.get("vm") or {}
    vm_id = str(vm.get("id") or "")
    if vm_id and "running" in runner(["qm", "status", vm_id]):
        rows.append(
            {
                "id": vm_id,
                "name": vm.get("name") or vm_id,
                "status": "running",
                "address": _vm_address(runner, vm_id, config.get("address_prefix") or ""),
                "kind": "vm",
            }
        )
    return rows


def _vm_address(runner, vm_id, prefix):
    raw = runner(["qm", "guest", "cmd", vm_id, "network-get-interfaces"], timeout=8)
    try:
        parsed = json.loads(raw) if raw else []
    except json.JSONDecodeError:
        return ""
    if isinstance(parsed, dict):
        interfaces = parsed.get("result") or []
    elif isinstance(parsed, list):
        interfaces = parsed
    else:
        interfaces = []
    for item in interfaces:
        for addr in item.get("ip-addresses") or []:
            ip = addr.get("ip-address") or ""
            if prefix and ip.startswith(prefix):
                return ip
    return ""
