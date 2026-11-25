"""Bounded commands for security patches and one enrolled Compose service."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

from homelab_panel.inventory import GUEST_ID


class MaintenanceError(Exception):
    """An operator-safe message. Command output may contain private settings."""


PACKAGE = re.compile(r"[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?")
VERSION = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9.+:~_-]*")
INST = re.compile(r"^Inst (\S+) \[([^\]]+)\] \((\S+) (.*)")
CRITICAL = re.compile(
    r"^(?:apt(?:-|$)|dpkg(?:-|$)|systemd|libsystemd|libudev|udev|libc[0-9]|linux-|pve|proxmox|"
    r"shim|grub|initramfs|zfs|libzfs|lvm|liblvm|libdevmapper|ceph|librados|librbd|corosync|"
    r"openssh|openssl|libssl|ifupdown|iproute|nftables|iptables|network-manager|"
    r"netplan|openswitch|openvswitch|tailscale|cloudflared|qemu|lxc|apparmor|"
    r"docker|containerd|runc|mount(?:-|$)|libmount|util-linux|libpam|login(?:-|$)|"
    r"cryptsetup|mdadm|multipath|systemd|dbus|libdbus|polkit|sudo|bash(?:-|$)|coreutils)"
)
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
COMPONENT = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}")
IMAGE = re.compile(r"[a-z0-9][a-z0-9./:_-]{0,238}:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}")
SERVICES = ("pve-cluster.service", "pvedaemon.service", "pveproxy.service", "pvestatd.service")
IDLE = ("homelab-update.service", "homelab-scan.service", "apt-daily.service", "apt-daily-upgrade.service")
APT_TRUST = ["-o", "APT::Get::AllowUnauthenticated=false", "-o", "Acquire::AllowInsecureRepositories=false",
             "-o", "Acquire::AllowWeakRepositories=false", "-o", "Acquire::AllowDowngradeToInsecureRepositories=false"]


def run_command(argv, *, timeout=25, data=None, lock_fd=None):
    env = dict(os.environ, LC_ALL="C", DEBIAN_FRONTEND="noninteractive",
               NEEDRESTART_MODE="l", APT_LISTCHANGES_FRONTEND="none")
    result = subprocess.run(
        argv, capture_output=True, text=True, input=data, timeout=timeout,
        env=env, pass_fds=() if lock_fd is None else (lock_fd,), check=True,
    )
    return result.stdout


def command(run, argv, message, **kwargs):
    try:
        return run(argv, **kwargs)
    except (OSError, subprocess.SubprocessError, UnicodeError) as exc:
        raise MaintenanceError(message) from exc


def read_json(text, message):
    try:
        return json.loads(text)
    except (ValueError, TypeError) as exc:
        raise MaintenanceError(message) from exc


def installed_operations(text, *, strict):
    result = {}
    for line in text.splitlines():
        if strict and (line.startswith(("Remv ", "Purg ")) or line.startswith("Conf ") and
                       (len(line.split()) < 2 or line.split()[1] not in result)):
            raise MaintenanceError("APT would remove or configure an unreviewed package.")
        if not line.startswith("Inst "):
            continue
        match = INST.match(line)
        if not match:
            if strict:
                raise MaintenanceError("APT would install a new package or could not describe the change.")
            continue
        name, previous, version, origin = match.groups()
        if not PACKAGE.fullmatch(name) or not VERSION.fullmatch(previous) or not VERSION.fullmatch(version) or name in result:
            if strict:
                raise MaintenanceError("APT returned an unrecognized package operation.")
            continue
        result[name] = {"current": previous, "candidate": version, "security": "Debian-Security:" in origin}
    return result


def from_debian_security(policy, version):
    # apt-cache policy lists one stanza per version, with Release metadata for each source.
    selected = False
    official = False
    for line in policy.splitlines():
        version_line = re.fullmatch(r"\s*(?:\*\*\*\s+)?(\S+)\s+\d+\s*", line)
        if version_line:
            selected = version_line[1] == version
            official = False
        if re.match(r"\s*\d+\s+\S+", line):
            official = bool(re.match(r"\s*\d+\s+https?://(?:security\.debian\.org|deb\.debian\.org)/debian-security\s", line))
        release = line.strip().removeprefix("release ")
        if selected and official and line.strip().startswith("release "):
            fields = dict(part.split("=", 1) for part in release.split(",") if "=" in part)
            if fields.get("o") == "Debian" and fields.get("l") == "Debian-Security" and fields.get("n", "").endswith("-security"):
                return True
    return False


def security_plan(run):
    simulation = command(run, ["apt-get", "-s", "upgrade"], "APT could not check the local package lists.")
    candidates = installed_operations(simulation, strict=False)
    packages = []
    for name, item in sorted(candidates.items()):
        if not item["security"] or name.startswith(("pve", "proxmox")):
            continue
        policy = command(run, ["apt-cache", "policy", name], "APT could not verify the security origin.")
        if not from_debian_security(policy, item["candidate"]):
            raise MaintenanceError("APT could not verify that every candidate comes from Debian Security.")
        packages.append({"name": name, "current": item["current"], "candidate": item["candidate"],
                         "critical": bool(CRITICAL.match(name))})
    if packages:
        validate_transaction(run, packages)
    return packages


def apt_arguments(packages):
    return [
        *APT_TRUST, "--only-upgrade", "--no-remove", "-o", "DPkg::Lock::Timeout=15",
        "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold",
        "install", *[f"{row['name']}={row['candidate']}" for row in packages],
    ]


def validate_transaction(run, packages):
    simulated = command(run, ["apt-get", "-s", *apt_arguments(packages)], "APT could not resolve the exact security versions.")
    resolved = installed_operations(simulated, strict=True)
    expected = {x["name"]: (x["current"], x["candidate"]) for x in packages}
    if {name: (item["current"], item["candidate"]) for name, item in resolved.items()} != expected:
        raise MaintenanceError("The package transaction changed. Prepare a new review.")


def apply_security(run, packages, lock_fd):
    args = apt_arguments(packages)
    command(run, ["apt-get", "-y", *args], "APT did not finish. Review the host package log before retrying.",
            timeout=None, lock_fd=lock_fd)
    spec = r"${binary:Package}\t${Version}\t${db:Status-Status}\n"
    installed = command(run, ["dpkg-query", "-W", "-f", spec], "Installed versions could not be verified.")
    versions = {fields[0]: fields[1] for line in installed.splitlines()
                if len(fields := line.split("\t")) == 3 and fields[2] == "installed"}
    for row in packages:
        if versions.get(row["name"], versions.get(row["name"] + ":amd64")) != row["candidate"]:
            raise MaintenanceError("Installed versions differ from the reviewed plan.")


def verify_host(run, *, idle):
    services = command(run, ["systemctl", "is-active", *SERVICES], "A Proxmox service is unavailable.")
    if services.splitlines() != ["active"] * len(SERVICES):
        raise MaintenanceError("A Proxmox service is unavailable.")
    if command(run, ["dpkg", "--audit"], "The package database could not be checked.").strip():
        raise MaintenanceError("The package database needs review.")
    if idle:
        if Path("/run/reboot-required").exists():
            raise MaintenanceError("The host already reports a pending reboot.")
        states = command(run, ["systemctl", "show", "-p", "ActiveState", "--value", *IDLE],
                         "Active maintenance could not be checked.")
        if states.split() != ["inactive"] * len(IDLE):
            raise MaintenanceError("Another maintenance or package job is active.")
        node = command(run, ["hostname", "-s"], "The Proxmox node could not be identified.").strip()
        if not COMPONENT.fullmatch(node):
            raise MaintenanceError("The Proxmox node could not be identified.")
        tasks = read_json(command(run, ["pvesh", "get", f"/nodes/{node}/tasks", "--source", "active", "--output-format", "json"],
                                  "Active Proxmox tasks could not be checked."), "Active Proxmox tasks could not be read.")
        if not isinstance(tasks, list) or tasks:
            raise MaintenanceError("Wait for active Proxmox tasks to finish.")


def app_spec(spec):
    if not isinstance(spec, dict):
        raise MaintenanceError("This application is not enrolled.")
    guest, service, path = (str(spec.get(key, "")) for key in ("guest", "service", "compose_file"))
    target = Path(path)
    if (not GUEST_ID.fullmatch(guest) or not COMPONENT.fullmatch(service)
            or not target.is_absolute() or not re.fullmatch(r"/opt/[a-zA-Z0-9_./-]+\.ya?ml", path)
            or ".." in target.parts):
        raise MaintenanceError("The enrolled Compose application has an invalid target.")
    source = str(spec.get("source", ""))
    probe = str(spec.get("health_url", ""))
    if (not IMAGE.fullmatch(source)
            or not re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):\d{1,5}/[a-zA-Z0-9_./-]*", probe)):
        raise MaintenanceError("The application requires an enrolled image and a guest-local HTTP health URL.")
    docker = ["pct", "exec", guest, "--", "docker"]
    compose = [*docker, "compose", "--project-directory", str(target.parent), "-f", path]
    return docker, compose, service, source, ["pct", "exec", guest, "--", "curl", "--noproxy", "*",
                                              "--fail", "--silent", "--max-time", "5", "--output", "/dev/null", probe]


def app_current(run, docker, compose, service):
    instances = command(run, [*compose, "ps", "-q", service], "The enrolled app container could not be found.").split()
    if len(instances) != 1 or not re.fullmatch(r"[a-f0-9]{12,64}", instances[0]):
        raise MaintenanceError("The enrolled service must have exactly one running container.")
    fields = command(
        run, [*docker, "inspect", "--format", "{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}", instances[0]],
        "The running application image could not be verified.",
    ).strip().split("|")
    if len(fields) != 3 or not DIGEST.fullmatch(fields[0]) or fields[1] != "running" or fields[2] not in {"", "healthy"}:
        raise MaintenanceError("The running application needs a health check.")
    return fields[0]


def app_plan(run, spec):
    docker, compose, service, source, probe = app_spec(spec)
    raw = command(run, [*compose, "config", "--format", "json"], "Compose configuration could not be read.")
    rendered = read_json(raw, "Compose configuration could not be read.")
    services = rendered.get("services", {}) if isinstance(rendered, dict) else {}
    target = services.get(service) if isinstance(services, dict) else None
    if (not isinstance(target, dict) or target.get("build") or target.get("depends_on")
            or target.get("post_start") or target.get("pre_start") or target.get("pre_stop") or len(services) != 1
            or target.get("image") != source):
        raise MaintenanceError("The enrolled service must use its configured registry image and run independently.")
    current = app_current(run, docker, compose, service)
    command(run, probe, "The app’s HTTP health check failed.")
    digests = read_json(command(run, [*docker, "image", "inspect", "--format", "{{json .RepoDigests}}", current],
                                "The running image digest could not be verified."), "The running image digest could not be read.")
    digest = command(run, [*docker, "buildx", "imagetools", "inspect", "--format", "{{.Manifest.Digest}}", source],
                     "The registry image digest could not be verified.").strip()
    if not DIGEST.fullmatch(digest) or not isinstance(digests, list):
        raise MaintenanceError("The registry or running image digest is unavailable.")
    repository = source.rsplit(":", 1)[0]
    reference = f"{repository}@{digest}"
    label = command(run, [*docker, "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.version"}}', current],
                    "The running application version could not be read.").strip()
    version = label if VERSION.fullmatch(label) else ""
    return {"current": current, "version": version, "candidate": reference,
            "available": all(not isinstance(value, str) or not value.endswith("@" + digest) for value in digests),
            "config_digest": hashlib.sha256(raw.encode()).hexdigest(),
            "target_digest": hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()}


def apply_app(run, app_id, spec, plan, token, lock_fd):
    docker, compose, service, source, probe = app_spec(spec)
    retained = f"homelab-rollback/{app_id}:{token}"
    command(run, [*docker, "image", "tag", plan["current"], retained],
            "The previous image could not be retained. No service update was started.", lock_fd=lock_fd)
    command(run, [*docker, "pull", plan["candidate"]], "The pinned image could not be downloaded. The service was not replaced.",
            timeout=300, lock_fd=lock_fd)
    expected = command(run, [*docker, "image", "inspect", "--format", "{{.Id}}", plan["candidate"]],
                       "The downloaded image could not be verified.").strip()
    if not DIGEST.fullmatch(expected):
        raise MaintenanceError("The downloaded image could not be verified.")
    if app_plan(run, spec) != plan:
        raise MaintenanceError("The running image, registry candidate, or configuration changed. Prepare a new review.")
    # Compose accepts JSON as YAML. The configured project file stays intact.
    override = json.dumps({"services": {service: {"image": plan["candidate"]}}})
    command(run, [*compose, "-f", "-", "up", "-d", "--no-deps", "--pull", "never", "--no-build", service],
            "Compose did not finish. Review the retained image and recovery evidence.",
            data=override, timeout=300, lock_fd=lock_fd)
    for _ in range(8):
        try:
            if app_current(run, docker, compose, service) == expected:
                command(run, probe, "The app’s HTTP health check failed.")
                return
        except MaintenanceError:
            pass
        time.sleep(3)
    raise MaintenanceError("The app health check failed. Review the retained image and backup before recovering.")
