import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from homelab_panel.schedule import (
    apply_schedule,
    coming_weekday,
    once_command,
    overlay_calendar,
    parse_day,
    parse_time,
    update_due,
)
from homelab_panel.server import Panel

PASSWORD_HASH = (
    "scrypt$16384$8$1$00112233445566778899aabbccddeeff$"
    "ac4c4b82446d8a2250ebb359ed8baa0460ec8a60dce30289b604b87ac0da177f"
    "9b26368c056a5bef16c1722a46c8fe811802d1927ce738fcf71587cd25bdca45"
)


class ScheduleTests(unittest.TestCase):
    def test_rejects_shell_metacharacters(self):
        self.assertIsNone(once_command("2026-12-01 06:00:00;rm"))
        self.assertIsNone(parse_time("06:00;rm"))
        self.assertIsNone(parse_day("2026-13-40"))
        command = once_command("2026-12-01 06:00:00")
        self.assertEqual(command[0], "systemd-run")
        self.assertNotIn(";", " ".join(command))
        self.assertEqual(coming_weekday(6, date(2026, 11, 25)).isoformat(), "2026-11-29")
        self.assertEqual(coming_weekday(6, date(2026, 11, 29)).isoformat(), "2026-11-29")

    def test_skip_move_and_one_extra_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            config = {"state_dir": directory, "config_path": "/etc/homelab-panel/config.json"}
            calls = []

            def runner(command):
                calls.append(list(command))
                return 0

            status, result = apply_schedule(
                config,
                "skip",
                {"weekday": 6},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 202)
            self.assertEqual(result["skip"], "2026-11-29")
            self.assertFalse(update_due(config, date(2026, 11, 29)))
            self.assertTrue(update_due(config, date(2026, 11, 30)))
            text = (root / "etc/systemd/system/homelab-update.service.d/panel.conf").read_text()
            self.assertIn("--update-due", text)
            self.assertNotIn(";", text)
            self.assertEqual(calls[-1], ["systemctl", "daemon-reload"])

            status, result = apply_schedule(
                config,
                "move",
                {"weekday": 1, "time": "05:30"},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 202)
            timer = (root / "etc/systemd/system/homelab-update.timer.d/panel.conf").read_text()
            self.assertIn("OnCalendar=Tue *-*-* 05:30:00\n", timer)
            self.assertNotIn(";", timer)
            calendar = overlay_calendar({"rules": [{"label": "Scan", "time": "04:00", "weekdays": None}], "standing": []}, {"weekly": result["weekly"]})
            self.assertEqual(calendar["rules"][1]["weekdays"], [1])

            before = len(calls)
            status, _ = apply_schedule(
                config,
                "move",
                {"weekday": 1, "time": "05:30;reboot"},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 400)
            self.assertEqual(len(calls), before)

            status, _ = apply_schedule(
                config,
                "once",
                {"date": "2026-12-01", "time": "09:15"},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 202)
            self.assertEqual(calls[-1][0], "systemd-run")
            self.assertIn("2026-12-01 09:15:00", calls[-1])
            self.assertNotIn(";", " ".join(calls[-1]))

            before = len(calls)
            status, _ = apply_schedule(
                config,
                "once",
                {"date": "2026-11-01", "time": "09:15"},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 400)
            self.assertEqual(len(calls), before)

            status, result = apply_schedule(
                config,
                "restore",
                {},
                runner,
                root=root,
                today=date(2026, 11, 25),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 202)
            self.assertEqual(result["skip"], "")
            self.assertTrue(update_due(config, date(2026, 11, 29)))

            before = len(calls)
            status, _ = apply_schedule(
                config,
                "once",
                {"date": "2026-11-25", "time": "01:00"},
                runner,
                root=root,
                today=date(2026, 11, 25),
                now=datetime(2026, 11, 25, 12, 0),
                executable="/usr/bin/python3",
                program="/opt/homelab-panel/current/homelab-panel.pyz",
            )
            self.assertEqual(status, 400)
            self.assertEqual(len(calls), before)

    def test_unconfirmed_schedule_does_not_run(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            class Missing:
                def get(self, url_path):
                    return None

            panel = Panel(
                {
                    "password_hash": PASSWORD_HASH,
                    "state_dir": directory,
                    "config_path": "/etc/homelab-panel/config.json",
                    "schedule_root": directory,
                    "refresh_seconds": 10,
                },
                lambda: {"timers": [], "guests": []},
                Missing(),
                starter=lambda command: calls.append(command) or 0,
            )
            status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
            cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
            status, _, body = panel.handle("POST", "/api/jobs/update/schedule", b'{"action":"once","date":"2026-12-01","time":"06:00"}', cookie)
            self.assertEqual(status, 400)
            self.assertIn("not confirmed", json.loads(body)["error"])
            self.assertEqual(calls, [])
