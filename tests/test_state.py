import datetime
import json
import unittest
from unittest import mock

import homelab_panel.collect as collect
from homelab_panel.collect import read_guests
from homelab_panel.identity import parse_identity
from homelab_panel.state import _run_view, build_state

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

    def test_xml_declaration_is_not_the_server_version(self):
        xml = '<?xml version="1.0"?><MediaContainer claimed="1" version="9.9.9"/>'
        self.assertEqual(parse_identity(xml)["version"], "9.9.9")

    def test_schedule_hides_housekeeping_and_notes_the_missing_package(self):
        state = build_state(CONFIG, snapshot())
        rows = {row["unit"]: row for row in state["health"]["housekeeping"]}
        self.assertIn("restarts playback", state["update"]["purpose"])
        self.assertIn("restarts playback", state["update"]["note"])
        self.assertIn("no vzdump", state["update"]["note"])
        self.assertIn("unattended-upgrades is not installed", rows["apt-daily-upgrade.timer"]["note"])
        self.assertIn("man-db.timer", rows)
        self.assertNotIn("homelab-scan.timer", rows)
        self.assertNotIn("homelab-update.timer", rows)

    def test_history_keeps_the_interrupted_pass_and_prefers_events(self):
        events = '{"ts":"2026-01-02T04:06:30+00:00","job":"scan","kind":"step","guest":"201","step":"clamav"}\n'
        state = build_state(CONFIG, snapshot(event_logs=[events]))
        scan = state["scan"]["history"]
        self.assertEqual(scan[0]["result"], "clean")
        self.assertIn("35 min", scan[0]["heading"])
        self.assertEqual(scan[0]["steps"], ["Guest 201 · Malware scan"])
        self.assertIn("=== homelab-scan start 2026-01-02T04:05:00+00:00 ===", scan[0]["transcript"])
        self.assertEqual(scan[1]["result"], "host example finding")
        self.assertNotIn("min", scan[1]["heading"])
        self.assertIn("dry run", state["update"]["history"][0]["heading"])
        self.assertTrue(state["update"]["history"][0]["heading"].startswith("2 Jan 2026, 03:04"))
        self.assertEqual(state["update"]["security"], 7)
        self.assertEqual(state["update"]["pending"], 4)
        self.assertTrue(state["update"]["dry"])
        self.assertNotIn("unfinished", state)
        self.assertNotIn("machineIdentifier", json.dumps(state))

    def test_a_timestamp_heading_drops_seconds(self):
        view = _run_view(
            {
                "start": "2024-06-07T08:05:09+00:00",
                "dry": True,
                "duration": "under a minute",
                "lines": ["kept"],
                "ok": True,
                "result": "dry run",
                "steps": [],
            }
        )
        self.assertEqual(view["heading"], "7 Jun 2024, 08:05 · dry run · under a minute")
        plain = _run_view(
            {
                "start": "not a timestamp",
                "dry": False,
                "duration": "2 min",
                "lines": [],
                "ok": False,
                "result": "incomplete",
                "steps": [],
            }
        )
        self.assertEqual(plain["heading"], "not a timestamp · 2 min")

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
        self.assertFalse(state["scan"]["idle"])
        self.assertEqual(state["scan"]["status"], "Scan running")
        self.assertEqual(state["scan"]["detail"], "Malware scan on guest 201")
        self.assertEqual(state["scan"]["elapsed"], "5 min")
        self.assertEqual(state["scan"]["started"], "04:05")
        self.assertEqual(state["scan"]["timeline"][0]["text"], "Guest 201 · Malware scan")
        self.assertEqual(state["scan"]["timeline"][0]["current"], True)
        self.assertEqual(state["scan"]["timeline"][0]["guest"], "201")
        self.assertEqual(state["scan"]["timeline"][0]["elapsed"], "5 min")
        self.assertIn("update waits", state["scan"]["lock"])
        self.assertEqual(state["update"]["status"], "Waiting")

    def test_open_run_marks_only_the_current_step(self):
        log = "=== homelab-scan start 2026-01-02T04:05:00+00:00 ===\n-- CT 201 leftovers --\n"
        events = "\n".join(
            [
                '{"ts":"2026-01-02T04:06:00+00:00","job":"scan","kind":"step","guest":"201","step":"leftovers"}',
                '{"ts":"2026-01-02T04:07:00+00:00","job":"scan","kind":"step","guest":"201","step":"clamav"}',
            ]
        )
        state = build_state(
            CONFIG,
            snapshot(
                scan_active=True,
                scan_since="Thu 2026-01-02 04:05:00 UTC",
                scan_started_us=1_767_000_000_000_000,
                scan_logs=[log],
                event_logs=[events],
            ),
            now=datetime.datetime.fromtimestamp(1_767_000_300, datetime.timezone.utc),
        )
        marked = [(item["text"], item["current"]) for item in state["scan"]["timeline"]]
        self.assertEqual(
            marked,
            [("Guest 201 · Leftover files", False), ("Guest 201 · Malware scan", True)],
        )

    def test_idle_copy_and_guest_rows(self):
        state = build_state(CONFIG, snapshot())
        self.assertTrue(state["scan"]["idle"])
        self.assertTrue(state["update"]["idle"])
        self.assertEqual(state["scan"]["status"], "Idle")
        self.assertEqual(state["scan"]["timeline"], [])
        self.assertIn("Last report", state["scan"]["detail"])
        self.assertNotIn("home", state)
        self.assertIn("findings", state)
        self.assertFalse(state["guest_updates"]["checked"])
        self.assertEqual(state["guest_updates"]["rows"], [])
        self.assertEqual(state["services"]["status"], "Not reported")

    def test_services_link_the_configured_guests(self):
        state = build_state(
            {
                **CONFIG,
                "vm": {"id": "216", "name": "house"},
                "guest_links": {**CONFIG["guest_links"], "208": "javascript:alert(1)"},
            },
            snapshot(
                guests=[
                    {"id": "201", "name": "media", "status": "running", "kind": "container", "address": "10.0.0.30"},
                    {"id": "216", "name": "house", "status": "stopped", "kind": "vm", "address": "10.0.0.16"},
                    {"id": "208", "name": "requests", "status": "running", "kind": "container", "address": "10.0.0.40"},
                ]
            ),
        )
        rows = {row["id"]: row for row in state["services"]["rows"]}
        self.assertEqual(rows["201"]["url"], "http://10.0.0.30:32400/web")
        self.assertEqual(rows["201"]["status"], "Running")
        self.assertEqual(rows["216"]["status"], "Stopped")
        self.assertEqual(rows["216"]["name"], "house")
        self.assertEqual(rows["208"]["url"], "")
        self.assertNotIn("javascript:", json.dumps(state["services"]))
        self.assertEqual(state["services"]["status"], "Needs a look")

    def test_a_dirty_scan_is_a_finding_and_a_clean_one_is_not(self):
        dirty = "=== homelab-scan start 2026-01-03T04:05:00+00:00 ===\nISSUE CT 201 leftover file\n"
        state = build_state(CONFIG, snapshot(scan_logs=[dirty]))
        self.assertEqual(state["findings"]["count"], 1)
        self.assertEqual(state["findings"]["items"][0]["guest"], "201")
        self.assertIn("leftover file", state["findings"]["items"][0]["result"])
        self.assertIn("ISSUE CT 201 leftover file", state["findings"]["items"][0]["transcript"])
        clean = build_state(CONFIG, snapshot())
        self.assertEqual(clean["findings"]["count"], 0)

    def test_storage_calls_out_a_full_mount_and_keeps_guest_disks(self):
        state = build_state(
            CONFIG,
            snapshot(
                mounts=[
                    {"mount": "/", "free": 20 * 1024 ** 3, "total": 32 * 1024 ** 3},
                    {"mount": "/mnt/shelf", "free": 1 * 1024 ** 3, "total": 40 * 1024 ** 3},
                ],
                storages=[
                    {"label": "local", "kind": "dir", "status": "active", "free": 20 * 1024 ** 3, "total": 32 * 1024 ** 3},
                    {"label": "guests", "kind": "zfspool", "status": "active", "free": 100 * 1024 ** 3, "total": 200 * 1024 ** 3},
                ],
            ),
        )
        labels = [row["label"] for row in state["storage"]["rows"]]
        self.assertEqual(labels, ["/", "/mnt/shelf", "guests"])
        self.assertEqual(state["storage"]["status"], "Low on disk")
        self.assertIn("/mnt/shelf", state["storage"]["summary"])

    def test_health_reads_load_memory_and_disk(self):
        state = build_state(
            CONFIG,
            snapshot(
                host={
                    "load": "0.40",
                    "memory_used": 8 * 1024 ** 3,
                    "memory_total": 16 * 1024 ** 3,
                    "disk_free": 20 * 1024 ** 3,
                    "disk_total": 32 * 1024 ** 3,
                }
            ),
        )
        self.assertEqual(state["health"]["status"], "All right")
        self.assertIn("Load 0.40", state["health"]["summary"])
        self.assertIn("8.0 GB", state["health"]["summary"])
        self.assertEqual(state["health"]["disk_free"], "20.0 GB")

    def test_low_disk_is_called_out(self):
        state = build_state(
            CONFIG,
            snapshot(host={"load": "1.0", "memory_used": 1024, "memory_total": 2048, "disk_free": 1, "disk_total": 100}),
        )
        self.assertEqual(state["health"]["status"], "Low on disk")

    def test_container_usage_stays_blank_when_numbers_are_missing(self):
        state = build_state(
            {**CONFIG, "vm": {"id": "216", "name": "house"}},
            snapshot(
                guests=[
                    {
                        "id": "201",
                        "name": "media",
                        "status": "running",
                        "kind": "container",
                        "address": "10.0.0.30",
                        "cpu": 0.5,
                        "mem": 1 * 1024**3,
                        "maxmem": 2 * 1024**3,
                        "disk": 3 * 1024**3,
                        "maxdisk": 8 * 1024**3,
                        "services": ["nginx", "nextcloud:apache"],
                    },
                    {"id": "216", "name": "house", "status": "stopped", "kind": "vm", "address": "10.0.0.16"},
                ]
            ),
        )
        rows = {row["id"]: row for row in state["services"]["rows"]}
        self.assertEqual(rows["201"]["cpu"], "50%")
        self.assertEqual(rows["201"]["memory"], "1.0 GB / 2.0 GB")
        self.assertEqual(rows["201"]["disk"], "3.0 GB / 8.0 GB")
        self.assertEqual(rows["201"]["services"], ["nginx", "nextcloud:apache"])
        self.assertEqual(rows["216"]["kind"], "vm")
        self.assertEqual(rows["216"]["status"], "Stopped")
        self.assertEqual(rows["216"]["cpu"], "")
        self.assertEqual(rows["216"]["memory"], "")
        self.assertEqual(rows["216"]["disk"], "")
        self.assertEqual(rows["216"]["services"], [])

    def test_running_container_reads_services_and_a_vm_does_not(self):
        commands = []

        def runner(command):
            commands.append(list(command))
            if command[:1] == ["pvesh"]:
                return json.dumps(
                    [
                        {"vmid": 201, "name": "media", "status": "running", "type": "lxc"},
                        {"vmid": 216, "name": "house", "status": "running", "type": "qemu", "cpu": 0.5},
                        {"vmid": 208, "name": "requests", "status": "stopped", "type": "lxc"},
                    ]
                )
            if command[:4] == ["pct", "exec", "201", "--"] and command[4] == "docker":
                return "web\tghcr.io/example/nextcloud:apache\n"
            if command[:3] == ["pct", "exec", "201"]:
                return "\n".join(
                    [
                        "docker.service loaded active running",
                        "containerd.service loaded active running",
                        "nginx.service loaded active running",
                        "systemd-journald.service loaded active running",
                        "cron.service loaded active running",
                    ]
                )
            return ""

        rows = {row["id"]: row for row in read_guests({**CONFIG, "vm": {"id": "216", "name": "house"}}, runner, lambda path: "")}
        self.assertEqual(rows["201"]["services"], ["nginx", "nextcloud:apache"])
        self.assertEqual(rows["216"]["services"], [])
        self.assertEqual(rows["208"]["services"], [])
        self.assertEqual(rows["216"]["cpu"], 0.5)
        self.assertNotIn("disk", rows["216"])
        self.assertIn(
            [
                "pct",
                "exec",
                "201",
                "--",
                "systemctl",
                "list-units",
                "--type=service",
                "--state=running",
                "--no-legend",
                "--plain",
                "--no-pager",
            ],
            commands,
        )
        self.assertFalse(any(item[:3] == ["pct", "exec", "216"] for item in commands))
        self.assertFalse(any(item[:3] == ["pct", "exec", "208"] for item in commands))

    def test_an_empty_runner_yields_no_inner_services_and_is_not_cached(self):
        calls = {"exec": 0}

        def runner(command):
            if command[:1] == ["pvesh"]:
                return json.dumps([{"vmid": 201, "name": "media", "status": "running", "type": "lxc"}])
            if command[:2] == ["pct", "exec"]:
                calls["exec"] += 1
                return ""
            return ""

        config = {"plex": {"guest_id": "201"}}
        first = read_guests(config, runner, lambda path: "")
        second = read_guests(config, runner, lambda path: "")
        self.assertEqual(first[0]["services"], [])
        self.assertEqual(second[0]["services"], [])
        self.assertEqual(calls["exec"], 2)

    def test_the_real_runner_caches_guest_exec(self):
        calls = []

        def fake(command, timeout=8):
            if command[:2] == ["pct", "exec"]:
                calls.append(timeout)
                return "nginx.service loaded active running\n"
            if command[:1] == ["pvesh"]:
                return json.dumps([{"vmid": 201, "name": "media", "status": "running", "type": "lxc"}])
            return ""

        config = {"plex": {"guest_id": "201"}}
        collect._SERVICE_CACHE.clear()
        try:
            with mock.patch("homelab_panel.collect.run", fake):
                first = read_guests(config, collect.run, lambda path: "")
                second = read_guests(config, collect.run, lambda path: "")
        finally:
            collect._SERVICE_CACHE.clear()
        self.assertEqual(first[0]["services"], ["nginx"])
        self.assertEqual(second[0]["services"], ["nginx"])
        self.assertEqual(calls, [4])

    def test_an_unmounted_disk_does_not_mark_the_page_unavailable(self):
        shelf = {
            "label": "shelf",
            "kind": "dir",
            "status": "inactive",
            "free": 0,
            "total": 0,
            "detail": "/mnt/fictional-shelf",
        }
        state = build_state(
            CONFIG,
            snapshot(
                mounts=[{"mount": "/", "free": 20 * 1024**3, "total": 32 * 1024**3}],
                storages=[shelf],
            ),
        )
        row = next(item for item in state["storage"]["rows"] if item["label"] == "shelf")
        self.assertEqual(row["status"], "Not mounted")
        self.assertEqual(row["detail"], "/mnt/fictional-shelf")
        self.assertEqual(row["free"], "")
        self.assertEqual(row["total"], "")
        self.assertEqual(state["storage"]["status"], "Room to spare")
        self.assertIn("shelf", state["storage"]["summary"])
        self.assertIn("not mounted", state["storage"]["summary"])
        self.assertNotIn("Unavailable", json.dumps(state["storage"]))
        alone = build_state(CONFIG, snapshot(mounts=[], storages=[shelf]))
        self.assertEqual(alone["storage"]["status"], "Not mounted")
        self.assertIn("shelf is not mounted", alone["storage"]["summary"])
        low = build_state(
            CONFIG,
            snapshot(
                mounts=[{"mount": "/mnt/fictional-full", "free": 1 * 1024**3, "total": 40 * 1024**3}],
                storages=[shelf],
            ),
        )
        self.assertEqual(low["storage"]["status"], "Low on disk")
        self.assertIn("/mnt/fictional-full", low["storage"]["summary"])
