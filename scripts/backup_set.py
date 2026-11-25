#!/usr/bin/env python3
"""Capture one quiesced PostgreSQL app and its explicitly selected files to restic.

The caller controls the approved maintenance window, quiescing, and resuming
the app. A captured archive cannot mark itself as a tested restore.
"""

import argparse
import fcntl
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}")


class BackupError(Exception):
    pass


def required_name(config, key):
    value = config.get(key)
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise BackupError(f"Configure a valid {key}.")
    return value


def absolute(value):
    if not isinstance(value, str) or not value.startswith("/") or ".." in Path(value).parts:
        raise BackupError("Configure absolute paths without parent traversal.")
    return Path(value)


def run(argv, *, timeout=30, stdout=None):
    result = subprocess.run(argv, stdout=subprocess.PIPE if stdout is None else stdout,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode != 0:
        raise BackupError(f"{argv[0]} failed with exit status {result.returncode}.")
    return result.stdout.decode("utf-8") if stdout is None else ""


class BackupSet:
    def __init__(self, config, command=run):
        self.command = command
        self.mount = absolute(config.get("mountpoint"))
        self.uuid = required_name(config, "uuid")
        self.directory = self.mount / required_name(config, "directory")
        self.password = absolute(config.get("password_file"))
        self.repo = self.directory / "applications"
        self.lock = absolute(config.get("lock_file", "/run/homelab-maintain.lock"))
        apps = config.get("apps")
        if not isinstance(apps, dict):
            raise BackupError("Configure the application inventory.")
        self.apps = apps

    def mounted(self):
        if any(path.is_symlink() for path in (self.mount, self.directory, self.repo)):
            raise BackupError("The backup mount and directories must not be symbolic links.")
        output = self.command(["findmnt", "-n", "-o", "UUID", "--mountpoint", str(self.mount)])
        if output.strip() != self.uuid:
            raise BackupError("The configured DAS filesystem is not mounted.")

    def app(self, name):
        spec = self.apps.get(name)
        if not NAME.fullmatch(name) or not isinstance(spec, dict):
            raise BackupError("Unknown or unenrolled app.")
        guest = required_name(spec, "guest")
        if not re.fullmatch(r"[0-9]{3,9}", guest):
            raise BackupError("Configure a valid Proxmox guest ID.")
        compose = absolute(spec.get("compose_file"))
        if not compose.is_relative_to("/opt") or compose.suffix not in {".yml", ".yaml"}:
            raise BackupError("The enrolled Compose file must live under /opt.")
        target = ["pct", "exec", guest, "--"]
        docker = [*target, "docker", "compose", "--project-directory", str(compose.parent), "-f", str(compose)]
        return spec, target, docker

    def confirm_quiesced(self, spec, docker):
        app = required_name(spec, "app_service")
        mode = spec.get("consistency")
        paused = spec.get("paused_services", [])
        if not isinstance(paused, list) or not all(isinstance(x, str) and NAME.fullmatch(x) for x in paused):
            raise BackupError("Configure valid service names for background writers.")
        if mode == "stopped":
            paused = [app, *paused]
        elif mode == "nextcloud_maintenance":
            status = self.command([*docker, "exec", "-T", "-u", "www-data", app, "php", "occ", "status", "--output=json"])
            if json.loads(status).get("maintenance") is not True:
                raise BackupError("Enable Nextcloud maintenance mode during the approved backup window.")
        else:
            raise BackupError("Configure a supported consistency check.")
        for service in paused:
            if self.command([*docker, "ps", "-q", "--status", "running", service]).strip():
                raise BackupError(f"Stop {service} during the approved backup window.")

    def sources(self, spec):
        raw = spec.get("data_paths")
        if not isinstance(raw, list) or not raw:
            raise BackupError("Configure all app-owned bind-mounted data paths.")
        result = []
        for value in raw:
            path = absolute(value)
            if not path.is_dir() or path.is_symlink():
                raise BackupError("An explicit app data directory is missing or symbolic.")
            source = path.resolve()
            target = self.directory.resolve()
            if source == target or source.is_relative_to(target) or target.is_relative_to(source) or source == Path("/"):
                raise BackupError("The backup repository and its parents cannot be app data sources.")
            fs = self.command(["findmnt", "-n", "-o", "UUID", "--target", str(source)])
            if fs.strip() != self.uuid:
                raise BackupError("An enrolled app data path is on an unexpected filesystem.")
            result.append(str(source))
        return result

    def restic(self):
        if not (self.repo / "config").is_file():
            raise BackupError("Initialize the dedicated restic repository before capture.")
        for path in (self.directory, self.repo):
            if path.stat().st_uid != os.geteuid() or path.stat().st_mode & 0o077:
                raise BackupError("Use host-only backup directories owned by the backup operator, with mode 0700.")
        if self.password.is_symlink() or not self.password.is_file() or self.password.stat().st_mode & 0o077:
            raise BackupError("Use a private restic password file with mode 0600.")
        return ["restic", "--repo", str(self.repo), "--password-file", str(self.password)]

    def capture(self, name):
        self.mounted()
        fd = os.open(self.lock, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise BackupError("Another maintenance job is active.") from exc
            return self.capture_locked(name)
        finally:
            os.close(fd)

    def capture_locked(self, name):
        spec, target, docker = self.app(name)
        sources = self.sources(spec)
        images = self.command([*docker, "images", "--format", "json"])
        self.confirm_quiesced(spec, docker)
        restic = self.restic()
        db = required_name(spec, "db_service")
        user, database = (required_name(spec, key) for key in ("db_user", "database"))
        guest_files = spec.get("guest_files")
        if not isinstance(guest_files, list) or spec["compose_file"] not in guest_files:
            raise BackupError("Include the enrolled Compose file and related app configuration.")
        for value in guest_files:
            source = absolute(value)
            if not source.is_relative_to("/opt") or source.suffix not in {".yml", ".yaml", ".php", ".env", ".ini", ".json"} and source.name != ".env":
                raise BackupError("Select individual configuration files below /opt.")
        self.mounted()
        with tempfile.TemporaryDirectory(prefix=f".{name}-capture-", dir=self.directory) as temporary:
            stage = Path(temporary)
            (stage / "images.json").write_text(images + "\n")
            for value in guest_files:
                source = absolute(value)
                dest = stage / "guest" / source.relative_to("/")
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open("wb") as output:
                    self.command([*target, "cat", "--", str(source)], stdout=output)
            if spec.get("consistency") == "nextcloud_maintenance":
                with (stage / "nextcloud-config.php").open("wb") as output:
                    app = required_name(spec, "app_service")
                    self.command([*docker, "exec", "-T", app, "cat", "/var/www/html/config/config.php"], stdout=output)
            with (stage / "database.dump").open("wb") as output:
                self.command([*docker, "exec", "-T", db, "pg_dump", "--no-owner", "--no-acl",
                              "--format=custom", "--username", user, "--dbname", database], stdout=output, timeout=1800)
            with (stage / "database.dump").open("rb") as dump:
                if dump.read(5) != b"PGDMP":
                    raise BackupError("The database export is not a PostgreSQL custom archive.")
            self.mounted()
            self.confirm_quiesced(spec, docker)
            output = self.command([*restic, "backup", "--json", "--tag", name, "--one-file-system", str(stage), *sources],
                                  timeout=8 * 60 * 60)
            self.confirm_quiesced(spec, docker)
            self.mounted()
            summaries = [item for line in output.splitlines() if (item := json.loads(line)).get("message_type") == "summary"]
            snapshot = summaries[-1].get("snapshot_id") if summaries else None
            if not isinstance(snapshot, str) or not re.fullmatch(r"[a-f0-9]{8,64}", snapshot):
                raise BackupError("Restic did not report a completed snapshot.")
            return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("app")
    args = parser.parse_args()
    try:
        os.umask(0o077)
        config = json.loads(args.config.read_text())
        if not isinstance(config, dict):
            raise BackupError("The backup configuration must be an object.")
        reference = BackupSet(config).capture(args.app)
    except (BackupError, OSError, ValueError, subprocess.SubprocessError) as exc:
        raise SystemExit(str(exc) if isinstance(exc, BackupError) else "The backup did not complete. Review the host and app state.") from None
    print(f"Captured {args.app} restic snapshot {reference}. Restore test still required.")


if __name__ == "__main__":
    main()
