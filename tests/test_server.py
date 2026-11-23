import json
import threading
import unittest
from http.client import HTTPConnection

from homelab_panel.config import ConfigError, parse_bind
from homelab_panel.server import Panel, make_handler
from http.server import ThreadingHTTPServer


class BindTests(unittest.TestCase):
    def test_refuses_every_interface(self):
        for value in ("0.0.0.0:8090", ":: :8090", ":8090"):
            with self.assertRaises(ConfigError):
                parse_bind(value if value != ":: :8090" else ":::8090")
        host, port = parse_bind("10.0.0.10:8090")
        self.assertEqual((host, port), ("10.0.0.10", 8090))


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
