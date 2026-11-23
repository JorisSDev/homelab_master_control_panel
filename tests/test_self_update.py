import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from homelab_panel.self_update import UpdateError, describe, install_release, version_key


def _unit(config_path):
    return f"[Service]\nExecStart=/usr/bin/python3 /opt/homelab-panel/0.3.0/homelab-panel.pyz --config {config_path}\n"


class SelfUpdateTests(unittest.TestCase):
    def test_a_newer_release_is_checksummed_and_queued(self):
        blob = b"panel-bytes"
        digest = hashlib.sha256(blob).hexdigest()
        calls = []

        def fetch_json(url):
            calls.append(url)
            return {"tag_name": "v0.4.0"}

        def fetch_bytes(url):
            calls.append(url)
            if url.endswith(".sha256"):
                return f"{digest}  homelab-panel.pyz\n".encode()
            return blob

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = root / "homelab-panel.service"
            config = root / "config.json"
            unit.write_text(_unit(config))
            config.write_text("{}")
            queued = []
            result = install_release(
                {
                    "install_root": str(root / "opt"),
                    "unit_path": str(unit),
                    "version_file": str(root / "installed-version"),
                    "config_path": str(config),
                    "release_repo": "Example/panel",
                },
                fetch_json=fetch_json,
                fetch_bytes=fetch_bytes,
                runner=lambda command: queued.append(command) or 0,
                version="v0.3.0",
            )
            self.assertEqual(result["status"], "installed")
            installed = root / "opt" / "0.4.0" / "homelab-panel.pyz"
            self.assertEqual(installed.read_bytes(), blob)
            self.assertEqual(oct(installed.stat().st_mode & 0o777), "0o755")
            self.assertEqual((root / "installed-version").read_text(), "v0.4.0\n")
            self.assertEqual(os.readlink(root / "opt" / "current"), str(root / "opt" / "0.4.0"))
            self.assertIn(str(installed), unit.read_text())
            self.assertIn(str(config), unit.read_text())
            self.assertEqual(queued[0][0], "systemd-run")
            script = (root / "restart.sh").read_text()
            self.assertIn("sleep 1", script)
            self.assertIn("homelab-panel.service", script)
            self.assertNotIn("homelab-scan", script)
            self.assertNotIn("homelab-update", script)
            self.assertTrue(any("api.github.com" in item for item in calls))
            self.assertFalse(any("github.com" == item for item in calls))

    def test_a_bad_checksum_leaves_the_unit_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = root / "homelab-panel.service"
            original = _unit(root / "config.json")
            unit.write_text(original)

            def fetch_bytes(url):
                if url.endswith(".sha256"):
                    return b"deadbeef  homelab-panel.pyz\n"
                return b"panel-bytes"

            with self.assertRaises(UpdateError):
                install_release(
                    {
                        "install_root": str(root / "opt"),
                        "unit_path": str(unit),
                        "version_file": str(root / "installed-version"),
                        "config_path": str(root / "config.json"),
                        "release_repo": "Example/panel",
                    },
                    fetch_json=lambda url: {"tag_name": "v0.4.0"},
                    fetch_bytes=fetch_bytes,
                    runner=lambda command: 0,
                    version="v0.3.0",
                )
            self.assertEqual(unit.read_text(), original)
            self.assertFalse((root / "installed-version").exists())

    def test_the_same_version_does_not_download(self):
        downloads = []
        result = install_release(
            {
                "install_root": "/tmp/unused",
                "unit_path": __file__,
                "version_file": "/tmp/unused-version",
                "config_path": __file__,
                "release_repo": "Example/panel",
            },
            fetch_json=lambda url: {"tag_name": "v0.4.0"},
            fetch_bytes=lambda url: downloads.append(url),
            version="v0.4.0",
        )
        self.assertEqual(result["status"], "current")
        self.assertEqual(downloads, [])

    def test_a_failed_queue_puts_the_previous_unit_back(self):
        blob = b"panel-bytes"
        digest = hashlib.sha256(blob).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = root / "homelab-panel.service"
            original = _unit(root / "config.json")
            unit.write_text(original)
            link = root / "opt" / "current"
            link.parent.mkdir()
            link.symlink_to(root / "opt" / "0.3.0")
            with self.assertRaises(UpdateError):
                install_release(
                    {
                        "install_root": str(root / "opt"),
                        "unit_path": str(unit),
                        "version_file": str(root / "installed-version"),
                        "config_path": str(root / "config.json"),
                        "release_repo": "Example/panel",
                    },
                    fetch_json=lambda url: {"tag_name": "v0.9.0"},
                    fetch_bytes=lambda url: f"{digest}  homelab-panel.pyz\n".encode() if url.endswith(".sha256") else blob,
                    runner=lambda command: 1,
                    version="v0.4.0",
                )
            self.assertEqual(unit.read_text(), original)
            self.assertEqual(os.readlink(link), str(root / "opt" / "0.3.0"))
            self.assertFalse((root / "installed-version").exists())

    def test_describe_compares_versions_without_installing(self):
        info = describe({"release_repo": "Example/panel"}, fetch_json=lambda url: {"tag_name": "v0.4.0"}, version="v0.3.0")
        self.assertTrue(info["update_available"])
        self.assertEqual(info["latest"], "v0.4.0")
        missing = describe({"release_repo": "not a repo"}, fetch_json=lambda url: {}, version="dev")
        self.assertEqual(missing["latest"], "")
        self.assertFalse(missing["update_available"])
        self.assertLess(version_key("dev"), version_key("v0.4.0"))
        self.assertLess(version_key("v0.3.9"), version_key("v0.4.0"))
