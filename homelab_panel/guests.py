"""Check and update one guest.

The check simulates an upgrade and finds Compose files. It does not install.
The update runs only after that one container is confirmed. Commands are argv
lists. Tests pass a runner and never call pct.
"""

from __future__ import annotations

import re
import subprocess

from homelab_panel.inventory import GUEST_ID, parse_simulation, wanted_ids

CHECK_TIMEOUT = 20
UPDATE_TIMEOUT = 900
COMPOSE_DIR = re.compile(r"^/opt/[A-Za-z0-9._/-]+$")
FLOATING_TAGS = {"latest", "main"}


def run_guest(command, timeout=CHECK_TIMEOUT):
    if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
        return None
    try:
        completed = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout or ""


def check_guests(config, snapshot, runner):
    by_id = {}
    for guest in snapshot.get("guests") or []:
        by_id[str(guest.get("id") or "")] = guest
    rows = []
    for guest_id in wanted_ids(config):
        guest = by_id.get(guest_id)
        if not guest or not running_container(config, guest):
            continue
        rows.append(_check_one(guest_id, _service_names(guest.get("services")), runner))
    return {"checked": True, "error": "", "rows": rows, "active": ""}


def update_guest(guest_id, directories, runner):
    if directories is None:
        found = _invoke(runner, _find_command(guest_id), CHECK_TIMEOUT)
        if found is None:
            return "The update did not finish."
        directories = compose_directories(found)
    else:
        directories = _valid_dirs(directories)
    steps = [
        ["pct", "exec", str(guest_id), "--", "apt-get", "update", "-qq"],
        [
            "pct",
            "exec",
            str(guest_id),
            "--",
            "apt-get",
            "-y",
            "-o",
            "Dpkg::Options::=--force-confdef",
            "-o",
            "Dpkg::Options::=--force-confold",
            "upgrade",
        ],
    ]
    for command in steps:
        if _invoke(runner, command, UPDATE_TIMEOUT) is None:
            return "The update did not finish."
    for directory in directories:
        filename = _compose_file(guest_id, directory, runner)
        if not filename:
            return "The update did not finish."
        for tail in (["pull"], ["up", "-d"]):
            command = [
                "pct",
                "exec",
                str(guest_id),
                "--",
                "docker",
                "compose",
                "-f",
                filename,
                "--project-directory",
                directory,
                *tail,
            ]
            if _invoke(runner, command, UPDATE_TIMEOUT) is None:
                return "The update did not finish."
    return ""


_SHELL = set(";|&$`<>\n\r")


def startup_commands(snapshot, ids):
    known = {}
    for guest in (snapshot or {}).get("guests") or []:
        if not isinstance(guest, dict):
            continue
        guest_id = str(guest.get("id") or "")
        if GUEST_ID.fullmatch(guest_id):
            known[guest_id] = guest
    if not isinstance(ids, list) or not ids:
        return "The order was not accepted.", []
    clean = []
    for item in ids:
        if isinstance(item, bool) or not isinstance(item, (str, int)):
            return "That machine is not on this host.", []
        guest_id = str(item)
        if not GUEST_ID.fullmatch(guest_id) or guest_id not in known or guest_id in clean:
            return "That machine is not on this host.", []
        clean.append(guest_id)
    if set(clean) != set(known):
        return "The order was not accepted.", []
    commands = []
    for index, guest_id in enumerate(clean, start=1):
        guest = known[guest_id]
        tool = "qm" if guest.get("kind") == "vm" else "pct"
        startup = f"order={index}"
        delay = guest.get("up")
        if tool == "pct" and type(delay) is int and delay >= 0:
            startup = f"order={index},up={delay}"
        command = [tool, "set", guest_id, "--startup", startup]
        if any(part in {"-c", "bash", "sh"} or any(char in part for char in _SHELL) for part in command):
            return "The order was not accepted.", []
        commands.append(command)
    return "", commands


def running_container(config, guest):
    guest_id = str(guest.get("id") or "")
    vm_id = str((config.get("vm") or {}).get("id") or "")
    kind = guest.get("kind") or ("vm" if guest_id == vm_id else "container")
    status = str(guest.get("status") or "").lower()
    return kind != "vm" and status == "running"


def compose_directories(text):
    found = []
    for raw in (text or "").splitlines():
        path = raw.strip()
        if ".." in path or not COMPOSE_DIR.fullmatch(path):
            continue
        if path not in found:
            found.append(path)
    return found


def has_floating_tag(services):
    for item in services:
        text = str(item or "").strip()
        if ":" not in text:
            continue
        tag = text.rsplit(":", 1)[1]
        if not tag or "/" in tag:
            continue
        if tag in FLOATING_TAGS:
            return True
    return False


def reboot_required(guest_id, runner):
    found = _invoke(
        runner,
        ["pct", "exec", str(guest_id), "--", "stat", "/var/run/reboot-required"],
        CHECK_TIMEOUT,
    )
    return bool(found)


def _check_one(guest_id, services, runner):
    apt = _invoke(runner, _apt_simulation(guest_id), CHECK_TIMEOUT)
    found = _invoke(runner, _find_command(guest_id), CHECK_TIMEOUT)
    error = ""
    packages = 0
    security = 0
    compose = []
    if apt is None:
        error = "The check did not finish."
    else:
        parsed = parse_simulation(apt)
        packages = parsed["total"] or 0
        security = parsed["security"] or 0
    if found:
        compose = compose_directories(found)
    return {
        "id": guest_id,
        "packages": packages,
        "security": security,
        "compose": compose,
        "floating": has_floating_tag(services),
        "reboot": reboot_required(guest_id, runner),
        "error": error,
    }


def _apt_simulation(guest_id):
    return ["pct", "exec", str(guest_id), "--", "apt-get", "-s", "-y", "upgrade"]


def _find_command(guest_id):
    return [
        "pct",
        "exec",
        str(guest_id),
        "--",
        "find",
        "/opt",
        "-maxdepth",
        "3",
        "(",
        "-name",
        "docker-compose.yml",
        "-o",
        "-name",
        "compose.yml",
        ")",
        "-printf",
        "%h\n",
    ]


def _compose_file(guest_id, directory, runner):
    for name in ("docker-compose.yml", "compose.yml"):
        path = f"{directory}/{name}"
        if _invoke(runner, ["pct", "exec", str(guest_id), "--", "test", "-f", path], CHECK_TIMEOUT) is not None:
            return path
    return ""


def _valid_dirs(directories):
    return compose_directories("\n".join(path for path in directories if isinstance(path, str)))


def _service_names(value):
    if not isinstance(value, list):
        return []
    names = []
    for item in value:
        text = str(item or "").strip()
        if text:
            names.append(text)
    return names


def _invoke(runner, command, timeout):
    try:
        result = runner(list(command), timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result is None or not isinstance(result, str):
        return None
    return result
