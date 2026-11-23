import datetime
import unittest

from homelab_panel.parse_timers import format_when, parse_timers, stamp


class TimerTests(unittest.TestCase):
    def test_microseconds_above_threshold(self):
        moment = stamp(1_700_000_000_000_000)
        self.assertEqual(moment.timestamp(), 1_700_000_000)

    def test_plain_seconds_stay_seconds(self):
        moment = stamp(1_700_000_000)
        self.assertEqual(moment.timestamp(), 1_700_000_000)

    def test_zero_and_missing_are_unscheduled(self):
        self.assertIsNone(stamp(0))
        self.assertIsNone(stamp(None))
        self.assertEqual(format_when(None, "not scheduled"), "not scheduled")
        self.assertEqual(format_when(None, "no run yet"), "no run yet")

    def test_left_field_is_not_a_duration(self):
        rows = parse_timers(
            [
                {
                    "unit": "homelab-scan.timer",
                    "next": 1_700_000_000_000_000,
                    "left": 99,
                    "last": 0,
                    "passed": 5,
                }
            ]
        )
        self.assertEqual(rows[0]["unit"], "homelab-scan.timer")
        self.assertEqual(rows[0]["next"].timestamp(), 1_700_000_000)
        self.assertIsNone(rows[0]["last"])
        self.assertNotIn("left", rows[0])

    def test_format_uses_local_calendar_fields(self):
        moment = datetime.datetime(2026, 1, 4, 6, 0, tzinfo=datetime.datetime.now().astimezone().tzinfo)
        self.assertIn("04 Jan 06:00", format_when(moment, "not scheduled"))
