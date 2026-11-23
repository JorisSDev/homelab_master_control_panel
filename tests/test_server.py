import json
import os
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

from homelab_panel.config import ConfigError, load_config, parse_bind
from homelab_panel.server import Panel, make_handler
from http.server import ThreadingHTTPServer


class BindTests(unittest.TestCase):
    def test_refuses_every_interface(self):
        for value in ("0.0.0.0:8090", ":: :8090", ":8090"):
            with self.assertRaises(ConfigError):
                parse_bind(value if value != ":: :8090" else ":::8090")
        host, port = parse_bind("10.0.0.10:8090")
        self.assertEqual((host, port), ("10.0.0.10", 8090))

    def test_bind_env_overrides_the_config_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"bind": "10.0.0.10:8090"}))
            with mock.patch.dict(os.environ, {"BIND": "127.0.0.1:8090"}):
                loaded = load_config(path)
        self.assertEqual((loaded["bind_host"], loaded["bind_port"]), ("127.0.0.1", 8090))


class ApiTests(unittest.TestCase):
    def test_get_returns_json_post_is_refused_and_the_cache_holds(self):
        calls = {"n": 0}

        def provider():
            calls["n"] += 1
            return {
                "timers": [],
                "scan_active": False,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "plex_xml": '<?xml version="1.0"?><MediaContainer claimed="1" machineIdentifier="secret-id" version="2.0"/>',
                "firewall_text": "disabled",
                "vzdump_text": "",
                "unattended_text": "install ok installed",
                "guests": [],
            }

        class Missing:
            def get(self, url_path):
                return None

        panel = Panel({"refresh_seconds": 10, "featured_timers": [], "plex": {}}, provider, Missing())
        status, headers, body = panel.handle("POST", "/api/state")
        self.assertEqual(status, 405)
        status, headers, body = panel.handle("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        payload = json.loads(body)
        self.assertNotIn("machineIdentifier", body.decode())
        self.assertNotIn("secret-id", body.decode())
        self.assertIn("now", payload)
        self.assertIn("schedule", payload)
        self.assertIn("history", payload)
        self.assertIn("unfinished", payload)
        panel.handle("GET", "/api/state")
        self.assertEqual(calls["n"], 1)

    def test_a_running_job_refreshes_after_one_second(self):
        calls = {"n": 0}

        def provider():
            calls["n"] += 1
            return {
                "timers": [],
                "scan_active": True,
                "scan_since": "now",
                "scan_started_us": 1_767_000_000_000_000,
                "update_active": False,
                "update_since": "",
                "update_started_us": 0,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "plex_xml": "",
                "firewall_text": "",
                "vzdump_text": "",
                "unattended_text": "",
                "guests": [],
            }

        class Missing:
            def get(self, url_path):
                return None

        panel = Panel({"cache_seconds": 5, "featured_timers": [], "plex": {}}, provider, Missing())
        with mock.patch("homelab_panel.server.time.monotonic", return_value=100.0):
            panel.handle("GET", "/api/state")
        with mock.patch("homelab_panel.server.time.monotonic", return_value=100.4):
            panel.handle("GET", "/api/state")
        self.assertEqual(calls["n"], 1)
        with mock.patch("homelab_panel.server.time.monotonic", return_value=101.1):
            panel.handle("GET", "/api/state")
        self.assertEqual(calls["n"], 2)

    def test_actions_start_only_when_the_gate_allows_it(self):
        started = []

        def provider():
            return {
                "timers": [],
                "scan_active": False,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "plex_xml": "",
                "firewall_text": "",
                "vzdump_text": "",
                "unattended_text": "",
                "guests": [],
            }

        class Missing:
            def get(self, url_path):
                return None

        config = {
            "cache_seconds": 5,
            "featured_timers": [],
            "plex": {},
            "scan_unit": "homelab-scan.service",
            "update_unit": "homelab-update.service",
            "update_confirmation": "restart playback",
        }
        panel = Panel(config, provider, Missing(), starter=lambda command: started.append(command) or 0)

        status, _, body = panel.handle("POST", "/api/actions/update", b'{"confirmation":"no"}')
        self.assertEqual(status, 400)
        self.assertIn(b"does not match", body)
        self.assertEqual(started, [])

        bare = dict(config)
        bare["update_confirmation"] = ""
        empty = Panel(bare, provider, Missing(), starter=lambda command: started.append(command) or 0)
        status, _, body = empty.handle("POST", "/api/actions/update", b'{"confirmation":"restart playback"}')
        self.assertEqual(status, 400)
        self.assertEqual(started, [])

        busy_snapshot = provider()
        busy_snapshot["scan_active"] = True
        busy = Panel(config, lambda: busy_snapshot, Missing(), starter=lambda command: started.append(command) or 0)
        status, _, body = busy.handle("POST", "/api/actions/scan", b"{}")
        self.assertEqual(status, 400)
        self.assertIn(b"already running", body)
        self.assertEqual(started, [])

        status, _, body = panel.handle("POST", "/api/state", b"{}")
        self.assertEqual(status, 405)
        self.assertEqual(started, [])

        status, _, body = panel.handle("POST", "/api/actions/scan", b"")
        self.assertEqual(status, 202)
        self.assertEqual(started, [["systemctl", "start", "--no-block", "homelab-scan.service"]])

        status, _, body = panel.handle("POST", "/api/actions/update", b'{"confirmation":"restart playback"}')
        self.assertEqual(status, 202)
        self.assertEqual(
            started,
            [
                ["systemctl", "start", "--no-block", "homelab-scan.service"],
                ["systemctl", "start", "--no-block", "homelab-update.service"],
            ],
        )

        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(panel))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            connection = HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("GET", "/api/state")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertNotIn(b"machineIdentifier", response.read())
            connection.request("POST", "/api/state")
            self.assertEqual(connection.getresponse().status, 405)
        finally:
            server.shutdown()
            server.server_close()
