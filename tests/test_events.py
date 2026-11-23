import unittest

from homelab_panel.parse_events import parse_events, steps_for_run

LOG_STEPS = ["-- CT 201 leftovers 2026-01-02T04:06:00+00:00 --"]


class EventTests(unittest.TestCase):
    def test_keeps_documented_fields_and_skips_broken_lines(self):
        text = "\n".join(
            [
                "not json",
                '{"ts":"2026-01-02T04:06:00+00:00","job":"scan","kind":"step","guest":"201","step":"leftovers"}',
                '{"ts":"2026-01-02T04:07:00+00:00","job":"update","kind":"start","dry":"1","message":"began"}',
            ]
        )
        events = parse_events([text])
        self.assertEqual(len(events), 2)
        self.assertEqual(
            set(events[0]),
            {"ts", "job", "kind", "guest", "step"},
        )
        self.assertEqual(events[1]["dry"], "1")
        self.assertEqual(events[1]["message"], "began")

    def test_rotated_file_comes_first(self):
        older = '{"ts":"2026-01-01T00:00:00+00:00","job":"scan","kind":"end","result":"clean"}'
        newer = '{"ts":"2026-01-02T00:00:00+00:00","job":"scan","kind":"start"}'
        events = parse_events([older, newer])
        self.assertEqual(events[0]["result"], "clean")
        self.assertEqual(events[1]["kind"], "start")

    def test_steps_inside_a_run_replace_log_markers(self):
        run = {
            "job": "scan",
            "start": "2026-01-02T04:05:00+00:00",
            "end": "2026-01-02T04:40:00+00:00",
            "steps": LOG_STEPS,
        }
        events = [
            {
                "ts": "2026-01-02T04:06:00+00:00",
                "job": "scan",
                "kind": "step",
                "guest": "201",
                "step": "leftovers",
            },
            {
                "ts": "2026-01-02T04:10:00+00:00",
                "job": "scan",
                "kind": "step",
                "guest": "host",
                "step": "clamav",
                "detail": "signatures",
            },
            {
                "ts": "2026-01-02T05:00:00+00:00",
                "job": "scan",
                "kind": "step",
                "guest": "202",
                "step": "leftovers",
            },
        ]
        self.assertEqual(
            steps_for_run(run, events),
            ["-- 201 leftovers --", "-- host clamav signatures --"],
        )

    def test_without_events_the_log_steps_remain(self):
        run = {
            "job": "scan",
            "start": "2026-01-02T04:05:00+00:00",
            "end": "2026-01-02T04:40:00+00:00",
            "steps": LOG_STEPS,
        }
        self.assertEqual(steps_for_run(run, []), LOG_STEPS)

    def test_open_run_stops_at_the_next_start(self):
        run = {
            "job": "scan",
            "start": "2026-01-02T04:00:00+00:00",
            "end": "",
            "steps": ["-- freshclam --"],
        }
        events = [
            {"ts": "2026-01-02T04:00:30+00:00", "job": "scan", "kind": "step", "guest": "host", "step": "freshclam"},
            {"ts": "2026-01-02T04:05:00+00:00", "job": "scan", "kind": "step", "guest": "201", "step": "leftovers"},
        ]
        self.assertEqual(
            steps_for_run(run, events, "2026-01-02T04:05:00+00:00"),
            ["-- host freshclam --"],
        )
