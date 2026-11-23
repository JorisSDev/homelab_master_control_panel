import datetime
import json
import unittest

from homelab_panel.identity import parse_identity
from homelab_panel.state import build_state

IDENTITY = """<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer claimed="1" machineIdentifier="secret-id" version="4.5.6-example"/>
"""

UNCLAIMED = """<?xml version="1.0"?>
<MediaContainer claimed="0" machineIdentifier="secret-id" version="1.0.0-abc"/>
"""

CONFIG = {
    "refresh_seconds": 10,
    "featured_timers": [
        {"unit": "homelab-scan.timer", "note": "Daily leftover and ClamAV scan. It does not restart apps."},
        {
            "unit": "homelab-update.timer",
            "note": "Sunday package and Compose update. It restarts playback and recreates apps. There is no vzdump copy to roll back to.",
        },
        {"unit": "apt-daily-upgrade.timer", "note": "Debian's daily upgrade timer."},
    ],
    "apt_daily_upgrade_unit": "apt-daily-upgrade.timer",
    "plex": {
        "guest_id": "201",
        "minimum_version": "1.2.3",
        "signin_url": "http://10.0.0.30:32400/web",
    },
    "wan_forward": "One TCP port stays the only intentional WAN forward.",
    "no_vzdump": "There is no vzdump job. The media database exists only on guest 201.",
    "compose_ids": ["208"],
    "guest_links": {"201": ":32400/web", "208": ":8080/"},
}

UPDATE = """=== homelab-update start 2026-01-02T03:04:05+00:00 dry=1 ===
-- CT 201 apt --
-- CT 208 compose /opt/demo --
Would upgrade 7 Debian security packages on the host.
4 non-security host packages left pending
=== homelab-update done 2026-01-02T03:04:40+00:00 ===
"""

SCAN = """=== homelab-scan start 2026-01-02T04:00:00+00:00 ===
ISSUE host example finding
=== homelab-scan start 2026-01-02T04:05:00+00:00 ===
-- CT 201 leftovers 2026-01-02T04:06:00+00:00 --
-- clamav CT 201 2026-01-02T04:06:02+00:00 --
scan clean
=== homelab-scan end 2026-01-02T04:40:00+00:00 rc=0 ===
"""


def snapshot(**overrides):
    base = {
        "timers": [
            {"unit": "homelab-scan.timer", "next": 1_767_960_000_000_000, "left": 1, "last": 0},
            {"unit": "man-db.timer", "next": 1_700_000_000_000_000, "left": 50, "last": 1_699_000_000_000_000},
            {"unit": "apt-daily-upgrade.timer", "next": 1_700_000_100_000_000, "left": 9, "last": 1_699_000_100_000_000},
        ],
        "scan_active": False,
        "scan_since": "",
        "scan_started_us": 0,
        "update_active": False,
        "update_since": "",
        "update_started_us": 0,
        "update_logs": [UPDATE],
        "scan_logs": [SCAN],
        "event_logs": [],
        "plex_xml": IDENTITY,
        "firewall_text": "Status: disabled/running",
        "vzdump_text": "# empty\nPATH=/usr/sbin\n",
        "unattended_text": "",
        "guests": [
            {"id": "201", "name": "media", "address": "10.0.0.30", "kind": "container"},
            {"id": "208", "name": "requests", "address": "10.0.0.40", "kind": "container"},
            {"id": "216", "name": "house", "address": "10.0.0.16", "kind": "vm"},
        ],
    }
    base.update(overrides)
    return base


class StateTests(unittest.TestCase):
    def test_identity_keeps_only_version_and_claimed(self):
        parsed = parse_identity(IDENTITY)
        self.assertEqual(parsed, {"version": "4.5.6-example", "claimed": "1"})
        self.assertNotIn("machineIdentifier", json.dumps(parsed))

    def test_claimed_server_has_no_sign_in_sentence(self):
        state = build_state(CONFIG, snapshot())
        encoded = json.dumps(state)
        self.assertNotIn("machineIdentifier", encoded)
        self.assertNotIn("secret-id", encoded)
        self.assertNotIn("sign-in", state["unfinished"]["facts"][0])
        self.assertIn("4.5.6-example", state["unfinished"]["facts"][0])
        self.assertIn("newer than 1.2.3", state["unfinished"]["facts"][0])

    def test_unclaimed_server_asks_for_sign_in(self):
        state = build_state(CONFIG, snapshot(plex_xml=UNCLAIMED))
        fact = state["unfinished"]["facts"][0]
        self.assertIn("http://10.0.0.30:32400/web", fact)
        self.assertIn("older than 1.2.3", fact)
        self.assertNotIn("machineIdentifier", json.dumps(state))

    def test_xml_declaration_is_not_the_server_version(self):
        xml = '<?xml version="1.0"?><MediaContainer claimed="1" version="9.9.9"/>'
        self.assertEqual(parse_identity(xml)["version"], "9.9.9")

    def test_schedule_hides_housekeeping_and_notes_the_missing_package(self):
        state = build_state(CONFIG, snapshot())
        units = [row["unit"] for row in state["schedule"]["featured"]]
        self.assertEqual(units, ["homelab-scan.timer", "homelab-update.timer", "apt-daily-upgrade.timer"])
        self.assertIn("restarts playback", state["schedule"]["featured"][1]["note"])
        self.assertIn("no vzdump", state["schedule"]["featured"][1]["note"])
        self.assertIn("unattended-upgrades is not installed", state["schedule"]["featured"][2]["note"])
        self.assertEqual(state["schedule"]["housekeeping"][0]["unit"], "man-db.timer")

    def test_history_keeps_the_interrupted_pass_and_prefers_events(self):
        events = '{"ts":"2026-01-02T04:06:30+00:00","job":"scan","kind":"step","guest":"201","step":"clamav"}\n'
        state = build_state(CONFIG, snapshot(event_logs=[events]))
        scan = state["history"]["scan"]
        self.assertEqual(scan[0]["result"], "clean")
        self.assertIn("35 min", scan[0]["heading"])
        self.assertEqual(scan[0]["steps"], ["-- 201 clamav --"])
        self.assertIn("=== homelab-scan start 2026-01-02T04:05:00+00:00 ===", scan[0]["transcript"])
        self.assertEqual(scan[1]["result"], "host example finding")
        self.assertNotIn("min", scan[1]["heading"])
        self.assertIn("dry run", state["history"]["update"][0]["heading"])
        self.assertIn("7 Debian security", state["unfinished"]["facts"][-1])
        self.assertIn("4 other host packages", state["unfinished"]["facts"][-1])

    def test_running_job_shows_step_and_elapsed(self):
        state = build_state(
            CONFIG,
            snapshot(
                scan_active=True,
                scan_since="Thu 2026-01-02 04:05:00 UTC",
                scan_started_us=1_767_000_000_000_000,
                event_logs=[
                    '{"ts":"2026-01-02T04:06:30+00:00","job":"scan","kind":"step","guest":"201","step":"clamav"}'
                ],
            ),
            now=datetime.datetime.fromtimestamp(1_767_000_300, datetime.timezone.utc),
        )
        self.assertFalse(state["now"]["idle"])
        self.assertEqual(state["now"]["step"], {"step": "clamav", "guest": "201"})
        self.assertEqual(state["now"]["jobs"][0]["elapsed"], "5 min")
        self.assertIn("maintenance lock", state["now"]["lock"])

    def test_idle_copy_and_guest_rows(self):
        state = build_state(CONFIG, snapshot())
        self.assertTrue(state["now"]["idle"])
        self.assertIn("Nothing is running", state["now"]["text"])
        media = state["unfinished"]["guests"][0]
        self.assertEqual(media["kind"], "apt")
        self.assertEqual(media["href"], "http://10.0.0.30:32400/web")
        self.assertEqual(media["last_update"], "seen in dry run")
        self.assertEqual(media["last_scan"], "clean")
        self.assertEqual(state["unfinished"]["guests"][1]["kind"], "compose")
        self.assertIn("firewall is off", state["unfinished"]["facts"][2])
        self.assertIn("no vzdump job", state["unfinished"]["facts"][3])

    def test_firewall_and_backup_changes_are_visible(self):
        state = build_state(
            CONFIG,
            snapshot(firewall_text="Status: enabled/running", vzdump_text="0 3 * * * root vzdump 201\n"),
        )
        self.assertIn("no longer reporting disabled", state["unfinished"]["facts"][2])
        self.assertIn("backup schedule is present", state["unfinished"]["facts"][3])
