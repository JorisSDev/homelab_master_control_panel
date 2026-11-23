"""Install a published GitHub release onto this host.

The page and ``--update`` call the same function. Nothing here starts the
scan or the Sunday update.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
ASSET = "homelab-panel.pyz"
DEFAULT_REPO = "JorisSDev/homelab_master_control_panel"


class UpdateError(RuntimeError):
    pass


def current_version():
    try:
        from importlib.resources import files

        text = files("homelab_panel").joinpath("VERSION").read_text(encoding="utf-8")
    except (FileNotFoundError, OSError, TypeError, ModuleNotFoundError):
        return "dev"
    text = text.strip()
    return text if TAG_RE.fullmatch(text) else "dev"


def version_key(tag):
    if not tag or tag == "dev":
        return (0,)
    return tuple(int(part) for part in tag[1:].split("."))


def release_urls(repo, tag):
    if not REPO_RE.fullmatch(repo or ""):
        raise UpdateError("The release repository is not valid.")
    if not TAG_RE.fullmatch(tag or ""):
        raise UpdateError("The release tag is not a version.")
    base = f"https://github.com/{repo}/releases/download/{tag}/{ASSET}"
    return base, base + ".sha256"


def latest_tag(repo, fetch_json):
    if not REPO_RE.fullmatch(repo or ""):
        raise UpdateError("The release repository is not valid.")
    payload = fetch_json(f"https://api.github.com/repos/{repo}/releases/latest")
    tag = (payload or {}).get("tag_name") or ""
    if not TAG_RE.fullmatch(tag):
        raise UpdateError("The latest release tag is not a version.")
    return tag


def describe(config, fetch_json=None, version=None):
    repo = config.get("release_repo") or DEFAULT_REPO
    installed = version or current_version()
    try:
        tag = latest_tag(repo, fetch_json or _fetch_json)
    except (UpdateError, OSError, ValueError):
        return {"version": installed, "latest": "", "update_available": False, "error": "Could not check GitHub."}
    return {
        "version": installed,
        "latest": tag,
        "update_available": version_key(tag) > version_key(installed),
        "error": "",
    }


def install_release(config, fetch_json=None, fetch_bytes=None, runner=None, wait=False, version=None):
    repo = config.get("release_repo") or DEFAULT_REPO
    installed = version or current_version()
    root = Path(config.get("install_root") or "/opt/homelab-panel")
    unit_path = Path(config.get("unit_path") or "/etc/systemd/system/homelab-panel.service")
    version_file = Path(config.get("version_file") or "/var/lib/homelab-panel/installed-version")
    config_path = config.get("config_path") or ""
    link = root / "current"
    if not config_path:
        raise UpdateError("The config path is missing.")
    if not unit_path.is_file():
        raise UpdateError("The panel service is not installed.")
    if link.exists() and not link.is_symlink():
        raise UpdateError("The current path is not a symlink.")
    tag = latest_tag(repo, fetch_json or _fetch_json)
    if version_key(tag) <= version_key(installed):
        return {"status": "current", "version": installed, "latest": tag}
    archive_url, checksum_url = release_urls(repo, tag)
    downloader = fetch_bytes or _fetch_bytes
    blob = downloader(archive_url)
    checksum = downloader(checksum_url).decode().split()[0].lower()
    digest = hashlib.sha256(blob).hexdigest()
    if not checksum or digest != checksum:
        raise UpdateError("The release checksum does not match.")
    previous = unit_path.read_text()
    if "ExecStart=" not in previous:
        raise UpdateError("The service unit has no ExecStart.")
    state = version_file.parent
    state.mkdir(parents=True, exist_ok=True)
    old_version = version_file.read_text() if version_file.is_file() else ""
    old_link = os.readlink(link) if link.is_symlink() else ""
    (state / "previous.service").write_text(previous)
    (state / "previous-version").write_text(old_version)
    (state / "previous-link").write_text(old_link)
    directory = root / tag[1:]
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / ASSET
    _write_bytes(target, blob, 0o755)
    _write_bytes(target.with_suffix(target.suffix + ".sha256"), f"{digest}  {ASSET}\n".encode(), 0o644)
    version_file.write_text(tag + "\n")
    if link.is_symlink():
        link.unlink()
    link.symlink_to(directory)
    unit_path.write_text(_rewrite_exec(previous, target, config_path))
    code = _restart(state, unit_path, version_file, link, runner or _run, wait)
    if code != 0:
        if not wait:
            _restore(state, unit_path, version_file, link)
        raise UpdateError("The new release did not stay running. The previous one was restored.")
    return {"status": "installed", "version": tag, "latest": tag}


def _rewrite_exec(text, target, config_path):
    found = False
    lines = []
    for line in text.splitlines():
        if line.startswith("ExecStart="):
            line = f"ExecStart=/usr/bin/python3 {target} --config {config_path}"
            found = True
        lines.append(line)
    if not found:
        raise UpdateError("The service unit has no ExecStart.")
    return "\n".join(lines) + "\n"


def _restart(state, unit_path, version_file, link, runner, wait):
    script = "\n".join(
        [
            "#!/bin/sh",
            "sleep 1",
            "systemctl daemon-reload",
            "systemctl restart homelab-panel.service",
            "sleep 3",
            "if systemctl is-active --quiet homelab-panel.service; then",
            "  exit 0",
            "fi",
            f"cp {state / 'previous.service'} {unit_path}",
            f"if [ -s {state / 'previous-version'} ]; then cp {state / 'previous-version'} {version_file}; else rm -f {version_file}; fi",
            f"old=$(cat {state / 'previous-link'})",
            'if [ -n "$old" ]; then',
            f"  ln -sfn \"$old\" {link}",
            "fi",
            "systemctl daemon-reload",
            "systemctl restart homelab-panel.service",
            "exit 1",
            "",
        ]
    )
    path = state / "restart.sh"
    path.write_text(script)
    path.chmod(0o755)
    if wait:
        return runner(["sh", str(path)])
    return runner(["systemd-run", "--unit=homelab-panel-apply", "--collect", "sh", str(path)])


def _restore(state, unit_path, version_file, link):
    unit_path.write_text((state / "previous.service").read_text())
    previous_version = state / "previous-version"
    if previous_version.is_file() and previous_version.stat().st_size:
        version_file.write_text(previous_version.read_text())
    elif version_file.exists():
        version_file.unlink()
    previous_link = (state / "previous-link").read_text().strip()
    if previous_link:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(previous_link)


def _write_bytes(path, data, mode):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.chmod(temporary, mode)
    temporary.replace(path)


def _fetch_json(url):
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "homelab-panel"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode())


def _fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "homelab-panel"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _run(command):
    try:
        completed = subprocess.run(command, timeout=30, check=False)
    except (subprocess.TimeoutExpired, OSError):
        return 1
    return completed.returncode
