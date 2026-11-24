import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from homelab_panel.signals import (
    blast_lines,
    fstab_waits,
    parse_guest_conf,
    parse_kernel_faults,
    parse_kuma_table,
    pins_match,
    redact,
    report_text,
    signature_age_days,
    vzdump_has_job,
)
from homelab_panel.store import load_checks, read_operator, save_checks, append_operator


CONF = """
onboot: 1
startup: order=2,up=15
nameserver: 10.0.0.1 10.0.0.2
mp0: /mnt/storage/media,mp=/media
mp1: /tmp/../secret,mp=/bad
"""


class SignalTests(unittest.TestCase):
    def test_guest_conf_reads_boot_dns_and_safe_mounts(self):
        parsed = parse_guest_conf(CONF)
        self.assertTrue(parsed["onboot"])
        self.assertEqual(parsed["order"], 2)
        self.assertEqual(parsed["up"], 15)
        self.assertEqual(parsed["nameservers"], ["10.0.0.1", "10.0.0.2"])
        self.assertEqual(parsed["mounts"], ["/mnt/storage/media"])

    def test_kuma_table_keeps_status_words_only(self):
        rows = parse_kuma_table("Plex\thttp\tup\t12:00\nDash\tpush\t9\t\n")
        self.assertEqual(rows[0]["status"], "up")
        self.assertEqual(rows[1]["status"], "unknown")
        self.assertNotIn("url", rows[0])

    def test_pins_and_vzdump_ignore_noise(self):
        self.assertTrue(pins_match(["10.0.0.1"], ["10.0.0.1", "1.1.1.1"]))
        self.assertFalse(pins_match(["10.0.0.1"], ["1.1.1.1"]))
        self.assertFalse(vzdump_has_job("# empty\nPATH=/usr/sbin\n"))
        self.assertTrue(vzdump_has_job("# note\n0 2 * * * root vzdump 100\n"))

    def test_disk_readings(self):
        faults = parse_kernel_faults("usb reset\nordinary line\nI/O error on sda\n")
        self.assertEqual(faults["count"], 2)
        self.assertIs(fstab_waits("UUID=abc /mnt/storage ext4 defaults,nofail,x-systemd.device-timeout=10 0 0\n", "/mnt/storage"), True)
        self.assertIs(fstab_waits("/dev/sda1 /mnt/storage ext4 defaults 0 0\n", "/mnt/storage"), False)

    def test_blast_names_later_guests_and_shared_disks(self):
        guests = [
            {"id": "1", "name": "dns", "order": 1, "mounts": ["/mnt/storage"]},
            {"id": "2", "name": "media", "order": 2, "mounts": ["/mnt/storage"]},
        ]
        lines = blast_lines(guests[0], guests)
        self.assertIn("Starts before 1 later guests", lines)
        self.assertIn("Shares /mnt/storage with media", lines)

    def test_report_redacts_addresses_and_secrets(self):
        text = report_text(
            {
                "panel": {"version": "dev"},
                "attention": [{"text": "token=abc at 10.0.0.5 machineIdentifier: xyz"}],
                "services": {"rows": [{"id": "1", "name": "media", "status": "Running", "order": 1}]},
                "reach": {"monitors": {"summary": "1 up", "rows": [{"name": "Plex", "status": "up"}]}},
                "scan": {"detail": "clean"},
                "das": {"summary": "Match"},
            }
        )
        self.assertNotIn("10.0.0.5", text)
        self.assertNotIn("abc", text)
        self.assertNotIn("xyz", text)
        self.assertIn("token=[redacted]", text)
        self.assertIn("machineIdentifier=[redacted]", text)
        self.assertIn("[address]", text)
        self.assertEqual(redact("password: hunter2"), "password=[redacted]")

    def test_signature_age(self):
        now = datetime(2026, 11, 24, tzinfo=timezone.utc)
        then = datetime(2026, 11, 20, tzinfo=timezone.utc).timestamp()
        self.assertGreater(signature_age_days(then, now), 3)
        self.assertIsNone(signature_age_days(None, now))

    def test_checks_and_operator_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {"state_dir": directory, "config_path": str(Path(directory) / "config.json")}
            save_checks(config, {"checked": True, "total": 1}, {"checked": True, "rows": [{"id": "201"}]})
            stored = load_checks(config)
            self.assertEqual(stored["packages"]["total"], 1)
            self.assertEqual(stored["guest_updates"]["rows"][0]["id"], "201")
            append_operator(config, "Checked host packages")
            self.assertIn("Checked host packages", read_operator(config)[0])
            raw = (Path(directory) / "checks.json").read_text()
            self.assertNotIn("password", json.loads(raw).__repr__().lower() or "")
            self.assertNotIn("token", raw)


if __name__ == "__main__":
    unittest.main()
