"""Pure readings for guests, disks, and a simulated package check.

Nothing here installs a package, starts a guest, or opens a shell.
"""

from __future__ import annotations

import json
import re
import subprocess
from urllib.parse import urlparse

SKIP_TYPES = {
    "proc",
    "sysfs",
    "devtmpfs",
    "tmpfs",
    "devpts",
    "cgroup",
    "cgroup2",
    "pstore",
    "bpf",
    "tracefs",
    "debugfs",
    "securityfs",
    "fusectl",
    "configfs",
    "ramfs",
    "squashfs",
    "overlay",
    "nsfs",
    "autofs",
    "mqueue",
    "hugetlbfs",
    "rpc_pipefs",
    "binfmt_misc",
}
SKIP_PREFIXES = ("/proc", "/sys", "/dev", "/run", "/snap")
ADDRESS = re.compile(r"\bip=(\d+\.\d+\.\d+\.\d+)\b")
GUEST_ID = re.compile(r"^\d{2,4}$")


def wanted_ids(config):
    ordered = []

    def add(value):
        text = str(value or "").strip()
        if GUEST_ID.fullmatch(text) and text not in ordered:
            ordered.append(text)

    plex = config.get("plex") or {}
    add(plex.get("guest_id"))
    vm = config.get("vm") or {}
    add(vm.get("id"))
    for value in config.get("compose_ids") or []:
        add(value)
    for value in (config.get("guest_links") or {}):
        add(value)
    return ordered


def parse_resources(text):
    try:
        payload = json.loads(text or "")
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, list):
        return {}
    rows = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        guest_id = str(item.get("vmid") or "")
        if not GUEST_ID.fullmatch(guest_id):
            continue
        rows[guest_id] = {
            "name": str(item.get("name") or ""),
            "status": str(item.get("status") or "").lower(),
            "kind": "vm" if item.get("type") == "qemu" else "container",
        }
    return rows


def parse_guest_table(text, kind):
    rows = {}
    lines = [line for line in (text or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return rows
    header = lines[0].split()
    if "VMID" not in header:
        return rows
    id_at = header.index("VMID")
    status_at = header.index("Status") if "Status" in header else header.index("STATUS") if "STATUS" in header else -1
    name_at = header.index("Name") if "Name" in header else header.index("NAME") if "NAME" in header else -1
    for line in lines[1:]:
        parts = line.split()
        if "Lock" in header and len(parts) == len(header) - 1:
            parts = parts[: status_at + 1] + [""] + parts[status_at + 1 :]
        if len(parts) <= id_at or not GUEST_ID.fullmatch(parts[id_at]):
            continue
        guest_id = parts[id_at]
        status = parts[status_at].lower() if status_at >= 0 and len(parts) > status_at else ""
        name = parts[name_at] if name_at >= 0 and len(parts) > name_at else ""
        rows[guest_id] = {"name": name, "status": status, "kind": kind}
    return rows


def parse_address(text):
    match = ADDRESS.search(text or "")
    return match.group(1) if match else ""


def service_url(link, address):
    link = (link or "").strip()
    if link.startswith(("http://", "https://")):
        return link if _safe(link) else ""
    if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", address or ""):
        return ""
    if link.startswith(":") or link.startswith("/"):
        candidate = f"http://{address}{link}"
        return candidate if _safe(candidate) else ""
    return ""


def parse_mounts(text):
    found = []
    seen = set()
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        mount = _unescape(parts[1])
        fstype = parts[2]
        if fstype in SKIP_TYPES or mount.startswith(SKIP_PREFIXES) or mount in seen:
            continue
        seen.add(mount)
        found.append({"mount": mount, "fstype": fstype})
    return found


def parse_pvesm(text):
    rows = []
    lines = [line for line in (text or "").splitlines() if line.strip()]
    if len(lines) < 2 or not lines[0].lower().startswith("name"):
        return rows
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6 or not parts[3].isdigit() or not parts[5].isdigit():
            continue
        rows.append(
            {
                "label": parts[0],
                "kind": parts[1],
                "status": parts[2].lower(),
                "total": int(parts[3]) * 1024,
                "free": int(parts[5]) * 1024,
            }
        )
    return rows


def parse_simulation(text):
    names = []
    security = 0
    for line in (text or "").splitlines():
        if not line.startswith("Inst "):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        names.append(parts[1])
        if "Debian-Security" in line:
            security += 1
    return {
        "checked": True,
        "total": len(names),
        "security": security,
        "pending": len(names) - security,
        "names": names[:40],
        "error": "",
    }


def check_packages(runner=None):
    command = ["apt-get", "-s", "upgrade"]
    if runner is not None:
        text = runner(command)
    else:
        try:
            completed = subprocess.run(
                command,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=20,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return _package_error()
        text = completed.stdout
        if completed.returncode != 0 and "Inst " not in text and "upgraded" not in text:
            return _package_error()
    if text is None:
        return _package_error()
    return parse_simulation(text)


def _package_error():
    return {"checked": False, "total": None, "security": None, "pending": None, "names": [], "error": "The package check did not finish."}


def _safe(url):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or not parsed.hostname:
        return False
    return True


def _unescape(value):
    return value.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")
