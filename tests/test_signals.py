import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from homelab_panel.observe import KUMA_SCRIPT, _CACHE, read_kuma
from homelab_panel.signals import (
    blast_lines,
    expand_month,
    fstab_waits,
    house_calendar,
    parse_guest_conf,
    parse_kernel_faults,
    parse_kuma_table,
    parse_on_calendar,
    pins_match,
    redact,
    report_text,
    signature_age_days,
    vzdump_has_job,
)
from homelab_panel.state import build_state
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
        secret = "http://10.0.0.41/api/push/secret"
        text = "\n".join(
            [
                "Plex\thttp\tup\t12:00",
                "Dash\tpush\t9\t",
                f"Photos\tping\tdown\t2026-11-24 12:00:00\t99.5\t98.0\t2026-11-20 01:00:00\t{secret}",
                "Blank\thttp\tpending\t2026-11-24 12:05:00\t\t100.0\t",
            ]
        )
        rows = parse_kuma_table(text)
        self.assertEqual(rows[0]["status"], "up")
        self.assertEqual(rows[1]["status"], "unknown")
        self.assertNotIn("url", rows[0])
        self.assertNotIn("uptime_24h", rows[0])
        self.assertEqual(rows[2]["uptime_24h"], 99.5)
        self.assertEqual(rows[2]["uptime_7d"], 98.0)
        self.assertEqual(rows[2]["last_down"], "2026-11-20 01:00:00")
        self.assertNotIn("url", rows[2])
        self.assertNotIn(secret, json.dumps(rows))
        self.assertIsNone(rows[3]["uptime_24h"])
        self.assertEqual(rows[3]["uptime_7d"], 100.0)
        self.assertEqual(rows[3]["last_down"], "")

    def test_on_calendar_expands_november_2026_and_skips_housekeeping(self):
        readings = {
            "homelab-scan.timer": "{ OnCalendar=*-*-* 04:00:00 ; next_elapse=Wed 2026-11-25 04:00:00 CET }\nRandomizedDelayUSec=0",
            "homelab-update.timer": "{ OnCalendar=Sun *-*-* 06:00:00 ; next_elapse=Sun 2026-11-29 06:00:00 CET }\nRandomizedDelayUSec=0",
            "pve-daily-update.timer": "{ OnCalendar=*-*-* 01:00:00 ; next_elapse=Wed 2026-11-25 01:00:00 CET }\nRandomizedDelayUSec=5h",
            "logrotate.timer": "{ OnCalendar=*-*-* 00:00:00 ; next_elapse=n/a }",
            "systemd-tmpfiles-clean.timer": "{ OnCalendar=*-*-* 03:00:00 ; next_elapse=n/a }",
        }
        self.assertEqual(parse_on_calendar(readings["homelab-scan.timer"])[0]["weekdays"], None)
        self.assertEqual(parse_on_calendar(readings["homelab-update.timer"])[0]["weekdays"], [6])
        self.assertEqual(parse_on_calendar("{ OnCalendar=hourly ; next_elapse=n/a }"), [])
        self.assertEqual(parse_on_calendar("{ OnCalendar=Mon..Fri *-*-* 09:00:00 ; }"), [])
        self.assertEqual(parse_on_calendar("{ OnCalendar=*-*-* 25:00:00 ; }"), [])
        self.assertEqual(parse_on_calendar(None), [])
        calendar = house_calendar(
            readings,
            [{"unit": "das-health.timer"}, {"unit": "logrotate.timer"}, "systemd-tmpfiles-clean.timer"],
        )
        by_label = {rule["label"]: rule for rule in calendar["rules"]}
        self.assertEqual(list(by_label), ["Scan", "Update", "Proxmox"])
        self.assertNotIn("until", by_label["Scan"])
        self.assertNotIn("until", by_label["Update"])
        self.assertEqual(by_label["Proxmox"]["until"], "06:00")
        self.assertEqual(calendar["standing"], ["Disk check runs every two minutes."])
        self.assertNotIn("Log rotate", json.dumps(calendar))
        self.assertNotIn("systemd tmpfiles", json.dumps(calendar))
        found = expand_month(calendar["rules"], 2026, 11)
        scans = [item for item in found if item["label"] == "Scan"]
        updates = [item for item in found if item["label"] == "Update"]
        proxmox = [item for item in found if item["label"] == "Proxmox"]
        self.assertEqual(len(scans), 30)
        self.assertTrue(all(item["time"] == "04:00" for item in scans))
        self.assertEqual(
            [item["date"] for item in updates],
            ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"],
        )
        self.assertTrue(all(item["time"] == "06:00" for item in updates))
        self.assertEqual(len(proxmox), 30)
        self.assertTrue(all(item["time"] == "01:00" for item in proxmox))
        self.assertEqual(house_calendar(readings, [])["standing"], [])
        self.assertEqual(_delay_rule("*-*-* 04:00:00", "30min")["until"], "04:30")
        self.assertEqual(_delay_rule("*-*-* 04:00:00", "90s")["until"], "04:01")
        self.assertEqual(_delay_rule("*-*-* 01:00:00", "18000000000")["until"], "06:00")
        self.assertNotIn("until", _delay_rule("*-*-* 04:00:00", "0"))
        self.assertEqual(_delay_rule("*-*-* 22:30:00", "5h")["until"], "23:59")

    def test_kuma_script_aggregates_in_sqlite_and_keeps_secrets_there(self):
        secret = "http://10.0.0.41/api/push/secret"
        now = datetime.now(timezone.utc).replace(microsecond=0)

        def stamp(delta):
            return (now + delta).strftime("%Y-%m-%d %H:%M:%S")

        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "kuma.db")
            connection = sqlite3.connect(path)
            connection.execute(
                "create table monitor (id integer primary key, name text, type text, url text, password text, headers text)"
            )
            connection.execute(
                "create table heartbeat (id integer primary key, monitor_id integer, status integer, time text, msg text)"
            )
            connection.execute(
                "insert into monitor values (1, 'Plex', 'http', ?, 'hunter2', 'Bearer secret')",
                (secret,),
            )
            connection.execute("insert into monitor values (2, 'Dash', 'push', ?, '', '')", (secret,))
            connection.execute("insert into monitor values (3, 'Shelf', 'ping', ?, '', '')", (secret,))
            recent_down = stamp(timedelta(minutes=-30)) + ".225"
            for monitor_id, status, when in (
                (1, 0, stamp(timedelta(days=-8))),
                (1, 0, stamp(timedelta(days=-3))),
                (1, 1, stamp(timedelta(days=-3, minutes=1))),
                (1, 3, stamp(timedelta(hours=-3))),
                (1, 2, stamp(timedelta(hours=-2))),
                (1, 1, stamp(timedelta(hours=-1))),
                (1, 0, recent_down),
                (1, 1, stamp(timedelta(minutes=-10))),
                (3, 0, stamp(timedelta(days=-40))),
            ):
                connection.execute(
                    "insert into heartbeat (monitor_id, status, time, msg) values (?, ?, ?, '')",
                    (monitor_id, status, when),
                )
            connection.commit()
            connection.close()
            completed = subprocess.run(
                [sys.executable, "-c", KUMA_SCRIPT.replace('"/opt/uptime-kuma/data/kuma.db"', repr(path))],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertNotIn(secret, completed.stdout)
            self.assertNotIn("hunter2", completed.stdout)
            self.assertNotIn("Bearer", completed.stdout)
            rows = {row["name"]: row for row in parse_kuma_table(completed.stdout)}
            self.assertNotIn("url", rows["Plex"])
            self.assertEqual(rows["Plex"]["status"], "up")
            self.assertEqual(rows["Plex"]["uptime_24h"], 66.7)
            self.assertEqual(rows["Plex"]["uptime_7d"], 60.0)
            self.assertEqual(rows["Plex"]["last_down"], recent_down)
            self.assertEqual(rows["Dash"]["status"], "unknown")
            self.assertIsNone(rows["Dash"]["uptime_24h"])
            self.assertIsNone(rows["Dash"]["uptime_7d"])
            self.assertEqual(rows["Dash"]["last_down"], "")
            self.assertEqual(rows["Shelf"]["status"], "down")
            self.assertEqual(rows["Shelf"]["last_down"], "")
            broken = os.path.join(directory, "broken.db")
            broken_db = sqlite3.connect(broken)
            broken_db.execute("create table monitor (id integer, name text)")
            broken_db.commit()
            broken_db.close()
            failed = subprocess.run(
                [sys.executable, "-c", KUMA_SCRIPT.replace('"/opt/uptime-kuma/data/kuma.db"', repr(broken))],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(failed.returncode, 0)
        lowered = KUMA_SCRIPT.lower()
        for word in ("url", "hostname", "password", "headers", "push_token"):
            self.assertNotIn(word, lowered)
        self.assertNotRegex(lowered, r"where\s+status\s*=\s*0\b")
        self.assertIn("max(case when status = 0 then time end)", lowered)
        self.assertIn("datetime('now', '-30 days')", lowered)
        _CACHE.clear()
        try:
            empty = read_kuma({"kuma": {"guest_id": "", "url": "http://10.0.0.41:3001"}}, lambda command: "called")
            unread = read_kuma({"kuma": {"guest_id": "201"}}, lambda command: "")
        finally:
            _CACHE.clear()
        self.assertEqual(empty["error"], "Kuma is not configured.")
        self.assertEqual(empty["rows"], [])
        self.assertEqual(unread, {"ok": False, "error": "Monitors could not be read.", "rows": []})

    def test_calendar_state_ignores_housekeeping_and_an_unsafe_kuma_link(self):
        state = build_state(
            {"kuma": {"guest_id": "", "url": "javascript:alert(1)"}},
            {
                "timers": [
                    {"unit": "das-health.timer", "next": 0, "last": 0},
                    {"unit": "logrotate.timer", "next": 0, "last": 0},
                ],
                "calendars": {
                    "homelab-scan.timer": "{ OnCalendar=*-*-* 04:00:00 ; next_elapse=n/a }",
                    "logrotate.timer": "{ OnCalendar=*-*-* 00:00:00 ; next_elapse=n/a }",
                },
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "guests": [],
            },
        )
        self.assertEqual(state["calendar"]["rules"], [{"label": "Scan", "time": "04:00", "weekdays": None}])
        self.assertEqual(state["calendar"]["standing"], ["Disk check runs every two minutes."])
        self.assertNotIn("logrotate", json.dumps(state["calendar"]))
        self.assertEqual(state["reach"]["kuma_url"], "")
        self.assertEqual(state["reach"]["monitors"]["error"], "Kuma is not configured.")
        self.assertNotIn("Kuma is not configured.", [item.get("text") for item in state["attention"]])
        linked = build_state(
            {"kuma": {"guest_id": "", "url": "http://10.0.0.41:3001"}},
            {"timers": [], "update_logs": [], "scan_logs": [], "event_logs": [], "guests": []},
        )
        self.assertEqual(linked["reach"]["kuma_url"], "http://10.0.0.41:3001")

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


def _delay_rule(expression, delay):
    text = "TimersCalendar={ OnCalendar=%s ; next_elapse=n/a }\nRandomizedDelayUSec=%s\n" % (expression, delay)
    return house_calendar({"homelab-scan.timer": text})["rules"][0]


if __name__ == "__main__":
    unittest.main()
