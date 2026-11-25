import json
import socket
import subprocess
import tempfile
import threading
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from homelab_panel.maintenance import Maintenance, MaintenanceError, now_utc, save_document
from homelab_panel.maintenance_actions import apply_app, from_debian_security, installed_operations, security_plan
from homelab_panel.server import Panel
from scripts.backup_set import BackupError, BackupSet


CANDIDATE = "Inst curl [1.0-1] (1.0-2 Debian-Security:stable-security [amd64])"
POLICY = """curl:
  Candidate: 1.0-2
  Version table:
     1.0-2 500
        500 http://deb.debian.org/debian-security stable-security/main amd64 Packages
            release o=Debian,n=stable-security,l=Debian-Security,c=main,b=amd64
 *** 1.0-1 100
"""
PACKAGE = {"name": "curl", "current": "1.0-1", "candidate": "1.0-2", "critical": False}
DIGEST = "sha256:" + "1" * 64
NEW = "sha256:" + "2" * 64


def config(path):
    return {"state_dir": str(path), "maintenance": {"enabled": True, "lock_file": str(path / "lock")}}


def receipt(hours=1):
    return {"backup_at": (now_utc() - timedelta(hours=hours)).isoformat(),
            "restore_tested_at": (now_utc() - timedelta(days=2)).isoformat(),
            "reference": "fixture backup", "coverage": ["configuration", "system"], "same_disk": False,
            "target": {"host": socket.gethostname().split(".")[0]}}


class PackagePlanning(unittest.TestCase):
    def test_pinned_security_candidates_come_from_debian_security(self):
        def run(argv):
            if argv[:2] == ["apt-cache", "policy"]:
                return POLICY
            if argv[-1] == "upgrade":
                return CANDIDATE + "\nInst pve-test [1] (2 Debian-Security:stable-security [amd64])"
            self.assertIn("curl=1.0-2", argv)
            self.assertIn("--no-remove", argv)
            return CANDIDATE
        self.assertEqual(security_plan(run), [PACKAGE])
        self.assertFalse(from_debian_security(POLICY, "1.0-1"))
        self.assertFalse(from_debian_security(POLICY.replace("o=Debian", "o=Other"), "1.0-2"))

    def test_dependency_additions_and_removals_fail_before_install(self):
        for line in ("Remv other [1.0]", "Inst other (2.0 Debian:stable [amd64])", "Conf other (2.0 Debian:stable [amd64])"):
            with self.subTest(line=line), self.assertRaises(MaintenanceError):
                installed_operations(CANDIDATE + "\n" + line, strict=True)


class ReviewedRuns(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name)
        self.config = config(self.path)
        self.engine = Maintenance(self.config)
        save_document(self.engine.receipts, {"security": receipt()})

    def test_preview_and_confirmation_are_scoped_to_exact_plan_and_single_use(self):
        done = threading.Event()
        with patch("homelab_panel.maintenance.security_plan", return_value=[PACKAGE]), \
                patch("homelab_panel.maintenance.verify_host"), \
                patch("homelab_panel.maintenance.apply_security") as apply:
            review = self.engine.preview("security")
            apply.assert_not_called()
            with self.assertRaises(MaintenanceError):
                self.engine.apply("other", review["id"])
            self.engine.apply("security", review["id"], done.set)
            self.assertTrue(done.wait(3))
            with self.assertRaises(MaintenanceError):
                self.engine.apply("security", review["id"])
            apply.assert_called_once()
        summary = self.engine.status()
        self.assertEqual(summary["history"][0]["status"], "success")
        self.assertTrue(summary["security"]["last_run"]["supervised"])

    def test_changed_plan_and_stale_evidence_do_not_install(self):
        done = threading.Event()
        changed = {**PACKAGE, "candidate": "1.0-3"}
        with patch("homelab_panel.maintenance.security_plan", side_effect=[[PACKAGE], [changed], [PACKAGE]]), \
                patch("homelab_panel.maintenance.verify_host"), \
                patch("homelab_panel.maintenance.apply_security") as apply:
            review = self.engine.preview("security")
            self.engine.apply("security", review["id"], done.set)
            self.assertTrue(done.wait(3))
            self.assertEqual(self.engine.status()["security"]["last_run"]["status"], "blocked")
            save_document(self.engine.receipts, {"security": receipt(30)})
            review = self.engine.preview("security")
            self.assertIn("24 hours", review["blocker"])
            with self.assertRaises(MaintenanceError):
                self.engine.apply("security", review["id"])
            apply.assert_not_called()

    def test_missing_private_evidence_and_shared_lock_block(self):
        self.engine.receipts.chmod(0o644)
        self.assertIsNone(self.engine.evidence("security"))
        with self.engine.exclusive(), self.assertRaises(MaintenanceError):
            with Maintenance(self.config).exclusive():
                self.fail("the shared lock permitted an overlapping run")

    def test_automation_demands_prior_supervised_run_and_rejects_critical_package(self):
        self.config["maintenance"]["security_auto"] = {"enabled": True, "allow_packages": ["curl"]}
        calls = []
        engine = Maintenance(self.config, lambda argv, **kwargs: calls.append(argv) or "")
        with self.assertRaisesRegex(MaintenanceError, "supervised"):
            engine.automatic_security()
        self.assertEqual(calls, [])
        save_document(engine.file, {"security": {"status": "success", "supervised": True}})
        with patch("homelab_panel.maintenance.verify_host"), \
                patch("homelab_panel.maintenance.security_plan", return_value=[{**PACKAGE, "critical": True}]), \
                patch("homelab_panel.maintenance.apply_security") as apply:
            self.assertIn("manual review", engine.automatic_security())
            apply.assert_not_called()
        self.assertEqual(engine.status()["security"]["automation_check"]["status"], "blocked")

    def test_automation_applies_only_the_approved_security_transaction(self):
        self.config["maintenance"]["security_auto"] = {"enabled": True, "allow_packages": ["curl"]}
        calls = []
        engine = Maintenance(self.config, lambda argv, **kwargs: calls.append(argv) or "")
        save_document(engine.file, {"security": {"status": "success", "supervised": True}})
        with patch("homelab_panel.maintenance.verify_host"), \
                patch("homelab_panel.maintenance.security_plan", return_value=[PACKAGE]), \
                patch("homelab_panel.maintenance.apply_security") as apply:
            self.assertIn("verified", engine.automatic_security())
            self.assertEqual(apply.call_args.args[1], [PACKAGE])
        self.assertEqual([argv[-1] for argv in calls], ["update"])
        run = engine.status()["security"]["last_run"]
        self.assertEqual(run["mode"], "automatic")
        self.assertTrue(run["supervised"])

    def test_authentication_and_explicit_apply_confirmation(self):
        panel = Panel(self.config, lambda: {}, {}, maintenance=self.engine)
        route = "/api/maintenance/security/"
        self.assertEqual(panel.handle("POST", route + "preview", b"{}")[0], 401)
        with patch.object(panel, "_authorized", return_value=True), patch.object(self.engine, "apply") as apply:
            self.assertEqual(panel.handle("POST", route + "apply", b'{"plan_id":"test"}')[0], 400)
            apply.assert_not_called()


class ScopedCompose(unittest.TestCase):
    def test_retains_old_image_and_applies_only_the_reviewed_service(self):
        application = {"guest": "234", "service": "subtitles", "compose_file": "/opt/example/compose.yml",
                       "source": "registry.example/subtitles:main", "health_url": "http://127.0.0.1:8090/health"}
        plan = {"current": DIGEST, "candidate": "registry.example/subtitles@" + NEW}
        calls = []

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if "{{.Id}}" in argv:
                return NEW
            return ""
        with patch("homelab_panel.maintenance_actions.app_plan", return_value=plan), \
                patch("homelab_panel.maintenance_actions.app_current", return_value=NEW):
            apply_app(run, "subtitles", application, plan, "review", 5)
        self.assertIn("homelab-rollback/subtitles:review", calls[0][0])
        self.assertIn(plan["candidate"], calls[1][0])
        args, kwargs = calls[3]
        self.assertEqual(args[:4], ["pct", "exec", "234", "--"])
        self.assertEqual(args[-8:], ["-", "up", "-d", "--no-deps", "--pull", "never", "--no-build", "subtitles"])
        self.assertEqual(json.loads(kwargs["data"]), {"services": {"subtitles": {"image": plan["candidate"]}}})
        self.assertTrue(any("curl" in argv for argv, _ in calls))

    def test_unhealthy_postflight_stops(self):
        spec = {"guest": "234", "service": "subtitles", "compose_file": "/opt/example/compose.yml",
                "source": "registry.example/subtitles:main", "health_url": "http://127.0.0.1:8090/health"}
        plan = {"current": DIGEST, "candidate": "registry.example/subtitles@" + NEW}

        def run(argv, **kwargs):
            if "curl" in argv:
                raise subprocess.CalledProcessError(1, argv)
            return NEW if "{{.Id}}" in argv else ""

        with patch("homelab_panel.maintenance_actions.app_plan", return_value=plan), \
                patch("homelab_panel.maintenance_actions.app_current", return_value=NEW), \
                patch("homelab_panel.maintenance_actions.time.sleep"), self.assertRaisesRegex(MaintenanceError, "health check"):
            apply_app(run, "subtitles", spec, plan, "review", 5)


class BackupGuards(unittest.TestCase):
    def test_wrong_disk_stops_before_any_capture(self):
        with tempfile.TemporaryDirectory() as path:
            commands = []
            config = {"mountpoint": path, "uuid": "expected-disk", "directory": "recovery",
                      "password_file": path + "/password", "apps": {}}
            backup = BackupSet(config, lambda argv, **kwargs: commands.append(argv) or "wrong-disk")
            with self.assertRaisesRegex(BackupError, "not mounted"):
                backup.capture("photos")
            self.assertEqual(commands, [["findmnt", "-n", "-o", "UUID", "--mountpoint", path]])
            self.assertFalse(backup.directory.exists())

    def test_captures_scoped_data_and_dump_without_claiming_restore_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            directory = path / "recovery"
            repo = directory / "applications"
            directory.mkdir(mode=0o700)
            repo.mkdir(mode=0o700)
            (repo / "config").touch()
            data = path / "photos"
            data.mkdir()
            password = path / "password"
            password.touch(mode=0o600)
            args = {"mountpoint": temporary, "uuid": "fixture-disk", "directory": "recovery",
                    "password_file": str(password), "lock_file": str(path / "lock"), "apps": {
                        "photos": {"guest": "234", "compose_file": "/opt/photos/compose.yml",
                                   "app_service": "photos", "db_service": "database", "db_user": "postgres",
                                   "database": "photos", "consistency": "stopped", "data_paths": [str(data)],
                                   "guest_files": ["/opt/photos/compose.yml"]}
                    }}
            captures = []
            def runner(argv, **kwargs):
                if argv[0] == "findmnt":
                    return "fixture-disk"
                if "images" in argv:
                    return "[]"
                if "ps" in argv:
                    return ""
                if "pg_dump" in argv:
                    kwargs["stdout"].write(b"PGDMP synthetic")
                    return ""
                if "cat" in argv:
                    kwargs["stdout"].write(b"services: {}")
                    return ""
                self.assertEqual(argv[0], "restic")
                self.assertEqual(argv[-1], str(data.resolve()))
                stage = Path(argv[-2])
                self.assertEqual((stage / "database.dump").read_bytes(), b"PGDMP synthetic")
                self.assertEqual((stage / "guest/opt/photos/compose.yml").read_bytes(), b"services: {}")
                captures.append(stage)
                return '{"message_type":"summary","snapshot_id":"1234abcd"}'
            self.assertEqual(BackupSet(args, runner).capture("photos"), "1234abcd")
            self.assertEqual(len(captures), 1)
            self.assertFalse(captures[0].exists())
            self.assertFalse((directory / "recovery-evidence.json").exists())
