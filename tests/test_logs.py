import unittest

from homelab_panel.parse_logs import parse_runs

UPDATE = """
=== homelab-update start 2026-01-02T03:04:05+00:00 dry=1 ===
-- CT 201 apt --
-- CT 208 compose /opt/demo --
-- host Debian security updates --
Would upgrade 7 Debian security packages on the host.
4 non-security host packages left pending
=== homelab-update done 2026-01-02T03:04:40+00:00 ===
"""

ROTATED = """
=== homelab-update start 2026-01-01T03:00:00+00:00 dry=0 ===
FAIL storage guest
"""

SCAN = """
=== homelab-scan start 2026-01-02T04:00:00+00:00 ===
-- freshclam --
ISSUE host example finding
-- CT 201 leftovers 2026-01-02T04:00:02+00:00 --
=== homelab-scan start 2026-01-02T04:05:00+00:00 ===
-- freshclam --
-- CT 201 leftovers 2026-01-02T04:06:00+00:00 --
scan clean
=== homelab-scan end 2026-01-02T04:40:00+00:00 rc=0 ===
"""


class LogTests(unittest.TestCase):
    def test_dry_update_counts_come_from_the_report(self):
        runs = parse_runs("update", ["", UPDATE])
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertTrue(run["dry"])
        self.assertTrue(run["ok"])
        self.assertEqual(run["result"], "dry run")
        self.assertEqual(run["security"], 7)
        self.assertEqual(run["pending"], 4)
        self.assertEqual(run["duration"], "under a minute")
        self.assertEqual(run["steps"][0], "-- CT 201 apt --")

    def test_rotated_log_is_older_and_a_failure_stays_a_failure(self):
        runs = parse_runs("update", [ROTATED, UPDATE])
        self.assertEqual([run["start"][:10] for run in runs], ["2026-01-01", "2026-01-02"])
        self.assertFalse(runs[0]["ok"])
        self.assertEqual(runs[0]["result"], "storage guest")
        self.assertEqual(runs[0]["end"], "")

    def test_interrupted_scan_stays_beside_the_clean_run(self):
        runs = parse_runs("scan", [SCAN])
        self.assertEqual(len(runs), 2)
        self.assertFalse(runs[0]["ok"])
        self.assertEqual(runs[0]["result"], "host example finding")
        self.assertEqual(runs[0]["end"], "")
        self.assertEqual(runs[0]["duration"], "")
        self.assertTrue(runs[1]["ok"])
        self.assertEqual(runs[1]["result"], "clean")
        self.assertEqual(runs[1]["duration"], "35 min")
        self.assertEqual(runs[1]["end"], "2026-01-02T04:40:00+00:00")
