import json
import os
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

from homelab_panel.auth import verify_password
from homelab_panel.config import ConfigError, load_config, parse_bind
from homelab_panel.guests import _check_one, startup_commands
from homelab_panel.server import Panel, make_handler

PASSWORD_HASH = (
    "scrypt$16384$8$1$00112233445566778899aabbccddeeff$"
    "ac4c4b82446d8a2250ebb359ed8baa0460ec8a60dce30289b604b87ac0da177f"
    "9b26368c056a5bef16c1722a46c8fe811802d1927ce738fcf71587cd25bdca45"
)
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

        panel = Panel(
            {"refresh_seconds": 10, "featured_timers": [], "plex": {}, "password_hash": PASSWORD_HASH},
            provider,
            Missing(),
        )
        status, headers, body = panel.handle("GET", "/api/state")
        self.assertEqual(status, 401)
        status, headers, body = panel.handle("POST", "/api/login", b'{"password":"no"}')
        self.assertEqual(status, 401)
        self.assertNotIn("Set-Cookie", headers)
        status, headers, body = panel.handle("POST", "/api/login", b'{"password":"example"}')
        self.assertEqual(status, 204)
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, headers, body = panel.handle("POST", "/api/state", b"{}", cookie)
        self.assertEqual(status, 405)
        status, headers, body = panel.handle("GET", "/api/state", headers=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        payload = json.loads(body)
        self.assertNotIn("machineIdentifier", body.decode())
        self.assertNotIn("secret-id", body.decode())
        self.assertNotIn("home", payload)
        self.assertIn("findings", payload)
        self.assertIn("guest_updates", payload)
        self.assertIn("update", payload)
        self.assertIn("scan", payload)
        self.assertIn("health", payload)
        self.assertIn("panel", payload)
        self.assertNotIn("unfinished", payload)
        panel.handle("GET", "/api/state", headers=cookie)
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

        panel = Panel(
            {"cache_seconds": 5, "featured_timers": [], "plex": {}, "password_hash": PASSWORD_HASH},
            provider,
            Missing(),
        )
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        self.assertEqual(status, 204)
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        with mock.patch("homelab_panel.server.time.monotonic", return_value=100.0):
            panel.handle("GET", "/api/state", headers=cookie)
        with mock.patch("homelab_panel.server.time.monotonic", return_value=100.4):
            panel.handle("GET", "/api/state", headers=cookie)
        self.assertEqual(calls["n"], 1)
        with mock.patch("homelab_panel.server.time.monotonic", return_value=101.1):
            panel.handle("GET", "/api/state", headers=cookie)
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
            "password_hash": PASSWORD_HASH,
        }
        panel = Panel(config, provider, Missing(), starter=lambda command: started.append(command) or 0)
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}

        status, _, body = panel.handle("POST", "/api/actions/update", b"{}", cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"not confirmed", body)
        self.assertEqual(started, [])

        status, _, body = panel.handle("POST", "/api/actions/scan", b"{}")
        self.assertEqual(status, 401)
        self.assertEqual(started, [])

        busy_snapshot = provider()
        busy_snapshot["scan_active"] = True
        busy = Panel(config, lambda: busy_snapshot, Missing(), starter=lambda command: started.append(command) or 0)
        status, headers, _ = busy.handle("POST", "/api/login", b'{"password":"example"}')
        busy_cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = busy.handle("POST", "/api/actions/scan", b"{}", busy_cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"already running", body)
        self.assertEqual(started, [])

        status, _, body = panel.handle("POST", "/api/state", b"{}", cookie)
        self.assertEqual(status, 405)
        self.assertEqual(started, [])

        status, _, body = panel.handle("POST", "/api/actions/scan", b"", cookie)
        self.assertEqual(status, 202)
        self.assertEqual(started, [["systemctl", "start", "--no-block", "homelab-scan.service"]])

        status, _, body = panel.handle("POST", "/api/actions/update", b'{"confirm":true}', cookie)
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
            self.assertEqual(connection.getresponse().status, 401)
            connection.request(
                "GET",
                "/api/state",
                headers={"Cookie": cookie["Cookie"]},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertNotIn(b"machineIdentifier", response.read())
            connection.request("POST", "/api/state", headers={"Cookie": cookie["Cookie"]})
            self.assertEqual(connection.getresponse().status, 405)
        finally:
            server.shutdown()
            server.server_close()

    def test_panel_update_is_signed_in_and_uses_the_shared_installer(self):
        calls = []

        def provider():
            return {
                "timers": [],
                "scan_active": False,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "unattended_text": "",
            }

        class Missing:
            def get(self, url_path):
                return None

        panel = Panel(
            {"cache_seconds": 5, "featured_timers": [], "password_hash": PASSWORD_HASH},
            provider,
            Missing(),
            starter=lambda command: calls.append(("start", command)) or 0,
            releases=lambda config: {"latest": "v0.4.0", "update_available": True, "error": ""},
            installer=lambda config: calls.append("install") or {"status": "installed", "version": "v0.4.0"},
        )
        status, _, _ = panel.handle("POST", "/api/panel/update", b"")
        self.assertEqual(status, 401)
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = panel.handle("GET", "/api/state", headers=cookie)
        payload = json.loads(body)
        self.assertEqual(payload["panel"]["latest"], "v0.4.0")
        self.assertTrue(payload["panel"]["update_available"])
        status, _, body = panel.handle("POST", "/api/panel/update", b"", cookie)
        self.assertEqual(status, 202)
        self.assertEqual(calls, ["install"])
        self.assertNotIn("homelab-scan", body.decode())

    def test_package_check_simulates_and_does_not_install(self):
        seen = []

        def provider():
            return {
                "timers": [],
                "scan_active": False,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "unattended_text": "",
            }

        class Missing:
            def get(self, url_path):
                return None

        def packages():
            seen.append(["apt-get", "-s", "upgrade"])
            return {
                "checked": True,
                "total": 2,
                "security": 1,
                "pending": 1,
                "names": ["openssl", "bash"],
                "error": "",
            }

        panel = Panel(
            {"cache_seconds": 5, "featured_timers": [], "password_hash": PASSWORD_HASH},
            provider,
            Missing(),
            starter=lambda command: seen.append(command) or 0,
            packages=packages,
        )
        status, _, _ = panel.handle("POST", "/api/packages/check", b"")
        self.assertEqual(status, 401)
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = panel.handle("POST", "/api/packages/check", b"", cookie)
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["names"], ["openssl", "bash"])
        self.assertEqual(seen, [["apt-get", "-s", "upgrade"]])
        status, _, body = panel.handle("GET", "/api/state", headers=cookie)
        self.assertEqual(json.loads(body)["packages"]["total"], 2)
        self.assertNotIn(b"apt-get install", body)

    def test_guest_check_and_update_stay_on_argv(self):
        calls = []
        done = threading.Event()

        def provider():
            return {
                "timers": [],
                "scan_active": False,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "unattended_text": "",
                "guests": [
                    {
                        "id": "201",
                        "name": "media",
                        "status": "running",
                        "kind": "container",
                        "services": ["plex:latest", "photo:v3", "db:16-alpine"],
                    },
                    {
                        "id": "209",
                        "name": "notes",
                        "status": "running",
                        "kind": "container",
                        "services": ["photo:v3", "db:16-alpine", "registry:5000/app"],
                    },
                    {"id": "208", "name": "files", "status": "stopped", "kind": "container", "services": []},
                    {"id": "216", "name": "house", "status": "running", "kind": "vm", "services": []},
                ],
            }

        class Missing:
            def get(self, url_path):
                return None

        config = {
            "cache_seconds": 5,
            "featured_timers": [],
            "password_hash": PASSWORD_HASH,
            "plex": {"guest_id": "201"},
            "vm": {"id": "216", "name": "house"},
            "compose_ids": ["208", "209"],
        }

        def runner(command, timeout=20):
            self.assertIsInstance(command, list)
            calls.append(list(command))
            if "apt-get" in command and "-s" in command:
                self.assertEqual(timeout, 20)
                self.assertIn("upgrade", command)
                if command[2] == "209":
                    return None
                return "Inst openssl [1.0] (1.1 Debian-Security)\nInst bash [2.0] (2.1 Debian:stable)\n"
            if "find" in command:
                self.assertFalse(any(".." in part for part in command))
                if command[2] == "201":
                    return "/opt/media\n/opt/bad/../secret\n/tmp/other\n/opt/stack\n"
                return ""
            if len(command) > 2 and command[2] == "209" and "apt-get" in command and "update" in command:
                return None
            if command[-2:] == ["up", "-d"] and "/opt/stack/docker-compose.yml" in command:
                done.set()
            return ""

        bare = Panel(config, provider, Missing())
        status, headers, _ = bare.handle("POST", "/api/login", b'{"password":"example"}')
        bare_cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = bare.handle("POST", "/api/guests/check", b"", bare_cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"This copy cannot update a guest.", body)
        status, _, body = bare.handle("POST", "/api/guests/201/update", b'{"confirm":true}', bare_cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"This copy cannot update a guest.", body)

        panel = Panel(config, provider, Missing(), guest_runner=runner)
        status, _, _ = panel.handle("POST", "/api/guests/201/update", b'{"confirm":true}')
        self.assertEqual(status, 401)
        self.assertEqual(calls, [])
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}

        status, _, body = panel.handle("POST", "/api/guests/201/update", b'{"confirm":false}', cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"not confirmed", body)
        status, _, body = panel.handle("POST", "/api/guests/201/update", b"{}", cookie)
        self.assertEqual(status, 400)
        self.assertEqual(calls, [])

        for path in ("/api/guests/nope/update", "/api/guests/1/update", "/api/guests/9999/update"):
            status, _, body = panel.handle("POST", path, b'{"confirm":true}', cookie)
            self.assertEqual(status, 400, path)
            self.assertIn(b"not configured", body)
        for path in ("/api/guests/216/update", "/api/guests/208/update"):
            status, _, body = panel.handle("POST", path, b'{"confirm":true}', cookie)
            self.assertEqual(status, 400, path)
            self.assertIn(b"running container", body)
        self.assertEqual(calls, [])

        status, _, body = panel.handle("POST", "/api/guests/check", b"", cookie)
        self.assertEqual(status, 200)
        checked = json.loads(body)
        self.assertNotIn("..", body.decode())
        rows = {row["id"]: row for row in checked["rows"]}
        self.assertEqual(set(rows), {"201", "209"})
        self.assertEqual(rows["201"]["packages"], 2)
        self.assertEqual(rows["201"]["security"], 1)
        self.assertEqual(rows["201"]["compose"], ["/opt/media", "/opt/stack"])
        self.assertTrue(rows["201"]["floating"])
        self.assertFalse(rows["209"]["floating"])
        self.assertTrue(rows["209"]["error"])
        self.assertEqual(checked["error"], "")
        check_calls = list(calls)
        self.assertIn(["pct", "exec", "201", "--", "apt-get", "-s", "-y", "upgrade"], check_calls)
        self.assertIn(
            [
                "pct",
                "exec",
                "201",
                "--",
                "find",
                "/opt",
                "-maxdepth",
                "3",
                "(",
                "-name",
                "docker-compose.yml",
                "-o",
                "-name",
                "compose.yml",
                ")",
                "-printf",
                "%h\n",
            ],
            check_calls,
        )
        for command in check_calls:
            self.assertNotIn("docker", command)
            self.assertNotIn("pull", command)
            if "upgrade" in command:
                self.assertIn("-s", command)
        before = len(calls)
        status, _, body = panel.handle("GET", "/api/state", headers=cookie)
        self.assertEqual(len(calls), before)
        state = json.loads(body)
        self.assertEqual(state["guest_updates"]["rows"][0]["compose"], ["/opt/media", "/opt/stack"])
        self.assertNotIn(b"apt-get install", body)

        mark = len(calls)
        status, _, body = panel.handle("POST", "/api/guests/201/update", b'{"confirm":true}', cookie)
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(body), {"started": "201"})
        self.assertTrue(done.wait(3))
        self._wait_until_idle(panel)
        update_calls = calls[mark:]
        self.assertIn(["pct", "exec", "201", "--", "apt-get", "update", "-qq"], update_calls)
        self.assertIn(
            [
                "pct",
                "exec",
                "201",
                "--",
                "apt-get",
                "-y",
                "-o",
                "Dpkg::Options::=--force-confdef",
                "-o",
                "Dpkg::Options::=--force-confold",
                "upgrade",
            ],
            update_calls,
        )
        self.assertIn(
            [
                "pct",
                "exec",
                "201",
                "--",
                "docker",
                "compose",
                "-f",
                "/opt/media/docker-compose.yml",
                "--project-directory",
                "/opt/media",
                "pull",
            ],
            update_calls,
        )
        self.assertIn(
            [
                "pct",
                "exec",
                "201",
                "--",
                "docker",
                "compose",
                "-f",
                "/opt/media/docker-compose.yml",
                "--project-directory",
                "/opt/media",
                "up",
                "-d",
            ],
            update_calls,
        )
        self.assertIn(
            ["pct", "exec", "201", "--", "test", "-f", "/opt/media/docker-compose.yml"],
            update_calls,
        )
        for command in update_calls:
            self.assertIsInstance(command, list)
            self.assertNotIn("-c", command)
            self.assertFalse(any(part in {"bash", "sh"} for part in command))
            for part in command:
                self.assertFalse(any(char in part for char in ";|&$`<>\n"))
                self.assertNotIn("..", part)
            if "upgrade" in command:
                self.assertNotIn("-s", command)
        self.assertFalse(any(part.endswith("/compose.yml") for command in update_calls for part in command))

        mark = len(calls)
        status, _, body = panel.handle("POST", "/api/guests/209/update", b'{"confirm":true}', cookie)
        self.assertEqual(status, 202)
        self._wait_until_idle(panel)
        failed = calls[mark:]
        self.assertIn(["pct", "exec", "209", "--", "apt-get", "update", "-qq"], failed)
        self.assertFalse(any("upgrade" in command for command in failed))
        self.assertFalse(any("compose" in command for command in failed))
        status, _, body = panel.handle("GET", "/api/state", headers=cookie)
        payload = json.loads(body)
        self.assertEqual(payload["guest_updates"]["active"], "")
        failed_row = {row["id"]: row for row in payload["guest_updates"]["rows"]}["209"]
        self.assertEqual(failed_row["error"], "The update did not finish.")

    def test_a_guest_update_waits_for_the_job_lock(self):
        calls = []
        entered = threading.Event()
        release = threading.Event()

        def provider(scan_active=False):
            return {
                "timers": [],
                "scan_active": scan_active,
                "update_active": False,
                "update_logs": [],
                "scan_logs": [],
                "event_logs": [],
                "unattended_text": "",
                "guests": [
                    {"id": "201", "name": "media", "status": "running", "kind": "container", "services": []},
                ],
            }

        class Missing:
            def get(self, url_path):
                return None

        config = {
            "cache_seconds": 5,
            "featured_timers": [],
            "password_hash": PASSWORD_HASH,
            "plex": {"guest_id": "201"},
        }

        busy = Panel(config, lambda: provider(scan_active=True), Missing(), guest_runner=lambda command, timeout=20: calls.append(command) or "")
        status, headers, _ = busy.handle("POST", "/api/login", b'{"password":"example"}')
        busy_cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = busy.handle("POST", "/api/guests/201/update", b'{"confirm":true}', busy_cookie)
        self.assertEqual(status, 400)
        self.assertIn(b"already running", body)
        self.assertEqual(calls, [])

        def runner(command, timeout=20):
            calls.append(list(command))
            if "upgrade" in command and "-s" not in command:
                entered.set()
                self.assertTrue(release.wait(3))
            return ""

        panel = Panel(config, provider, Missing(), guest_runner=runner)
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        try:
            status, _, body = panel.handle("POST", "/api/guests/201/update", b'{"confirm":true}', cookie)
            self.assertEqual(status, 202)
            self.assertTrue(entered.wait(3))
            status, _, body = panel.handle("POST", "/api/guests/201/update", b'{"confirm":true}', cookie)
            self.assertEqual(status, 400)
            self.assertIn(b"already running", body)
        finally:
            release.set()
        self._wait_until_idle(panel)

    def _wait_until_idle(self, panel):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if panel._guest_active == "":
                return
            time.sleep(0.01)
        self.fail("guest update did not finish")


class GuestCheckTests(unittest.TestCase):
    def test_a_missing_opt_keeps_the_apt_result(self):
        def runner(command, timeout=20):
            if "find" in command:
                return None
            if "apt-get" in command:
                return "Inst bash [1.0] (2.0 Debian:stable)\n"
            return ""

        row = _check_one("201", [], runner)
        self.assertEqual(row["packages"], 1)
        self.assertEqual(row["compose"], [])
        self.assertEqual(row["error"], "")


class BootOrderTests(unittest.TestCase):
    def test_startup_commands_set_order_without_a_shell(self):
        snapshot = {
            "guests": [
                {"id": "201", "kind": "container", "status": "running", "up": 30},
                {"id": "216", "kind": "vm", "status": "stopped", "up": 10},
            ]
        }
        error, commands = startup_commands(snapshot, ["216", "201"])
        self.assertEqual(error, "")
        self.assertEqual(commands[0], ["qm", "set", "216", "--startup", "order=1"])
        self.assertEqual(commands[1], ["pct", "set", "201", "--startup", "order=2,up=30"])
        for command in commands:
            self.assertTrue(command[0] in {"pct", "qm"})
            self.assertIn("set", command)
            self.assertIn("--startup", command)
            self.assertNotIn("-c", command)
            self.assertNotIn("bash", command)
            for part in command:
                self.assertNotRegex(part, r"[;&|$`<>]")
        rejected, none = startup_commands(snapshot, ["999"])
        self.assertTrue(rejected)
        self.assertEqual(none, [])
        partial, skipped = startup_commands(snapshot, ["201"])
        self.assertTrue(partial)
        self.assertEqual(skipped, [])

    def test_order_endpoint_writes_startup_and_rejects_unknown_ids(self):
        calls = []

        def runner(command, timeout=20):
            calls.append(list(command))
            return ""

        snapshot = {
            "guests": [
                {"id": "201", "kind": "container", "status": "running", "up": 30},
                {"id": "216", "kind": "vm", "status": "stopped"},
            ]
        }
        panel = Panel(
            {"cache_seconds": 5, "featured_timers": [], "password_hash": PASSWORD_HASH},
            lambda: snapshot,
            {},
            guest_runner=runner,
        )
        status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
        cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
        status, _, body = panel.handle(
            "POST",
            "/api/guests/order",
            b'{"confirm":true,"ids":["216","201"]}',
            cookie,
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True})
        self.assertEqual(calls[0], ["qm", "set", "216", "--startup", "order=1"])
        self.assertEqual(calls[1], ["pct", "set", "201", "--startup", "order=2,up=30"])
        before = len(calls)
        status, _, _ = panel.handle("POST", "/api/guests/order", b'{"confirm":true,"ids":["999"]}', cookie)
        self.assertEqual(status, 400)
        self.assertEqual(len(calls), before)
        status, _, _ = panel.handle("POST", "/api/guests/order", b'{"ids":["216","201"]}', cookie)
        self.assertEqual(status, 400)
        self.assertEqual(len(calls), before)


class SessionTests(unittest.TestCase):
    def test_remember_lasts_thirty_days_and_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = {
                "cache_seconds": 5,
                "featured_timers": [],
                "password_hash": PASSWORD_HASH,
                "state_dir": tmp,
            }
            panel = Panel(config, lambda: {}, {})
            status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
            self.assertEqual(status, 204)
            self.assertIn("Max-Age=43200", headers["Set-Cookie"])
            self.assertIn("HttpOnly", headers["Set-Cookie"])
            self.assertIn("SameSite=Strict", headers["Set-Cookie"])
            self.assertIn("Path=/", headers["Set-Cookie"])
            status, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example","remember":true}')
            self.assertEqual(status, 204)
            cookie = headers["Set-Cookie"]
            self.assertIn("Max-Age=2592000", cookie)
            token = cookie.split(";", 1)[0].split("=", 1)[1]
            raw = Path(tmp, "sessions.json").read_text()
            self.assertNotIn("example", raw)
            self.assertNotIn("password", raw)
            self.assertIn(token, raw)
            self.assertEqual(Path(tmp, "sessions.json").stat().st_mode & 0o777, 0o600)
            restarted = Panel(config, lambda: {}, {})
            status, _, _ = restarted.handle("GET", "/api/state", headers={"Cookie": f"panel_session={token}"})
            self.assertEqual(status, 200)
            restarted.handle("POST", "/api/logout", headers={"Cookie": f"panel_session={token}"})
            self.assertNotIn(token, Path(tmp, "sessions.json").read_text())
            status, _, _ = restarted.handle("GET", "/api/state", headers={"Cookie": f"panel_session={token}"})
            self.assertEqual(status, 401)

    def test_password_change_checks_the_current_password_and_hides_the_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "panel.json"
            path.write_text(json.dumps({"password_hash": PASSWORD_HASH, "bind": "10.0.0.10:8090", "roles": {"201": "media"}}))
            config = {
                "password_hash": PASSWORD_HASH,
                "config_path": str(path),
                "state_dir": tmp,
                "featured_timers": [],
                "cache_seconds": 5,
            }
            panel = Panel(config, lambda: {}, {})
            _, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example","remember":true}')
            cookie = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
            _, headers, _ = panel.handle("POST", "/api/login", b'{"password":"example"}')
            other = {"Cookie": headers["Set-Cookie"].split(";", 1)[0]}
            status, _, body = panel.handle(
                "POST",
                "/api/password",
                b'{"current":"wrong","new":"next-one","confirm":"next-one"}',
                cookie,
            )
            self.assertEqual(status, 401)
            self.assertNotIn(b"next-one", body)
            status, _, _ = panel.handle(
                "POST",
                "/api/password",
                b'{"current":"example","new":"next-one","confirm":"nope"}',
                cookie,
            )
            self.assertEqual(status, 400)
            status, _, _ = panel.handle(
                "POST",
                "/api/password",
                b'{"current":"example","new":" ","confirm":" "}',
                cookie,
            )
            self.assertEqual(status, 400)
            status, _, body = panel.handle(
                "POST",
                "/api/password",
                b'{"current":"example","new":"next-one","confirm":"next-one"}',
                cookie,
            )
            self.assertEqual(status, 200)
            self.assertNotIn(b"next-one", body)
            self.assertNotIn(b"scrypt$", body)
            saved = json.loads(path.read_text())
            self.assertNotEqual(saved["password_hash"], PASSWORD_HASH)
            self.assertEqual(saved["roles"]["201"], "media")
            self.assertEqual(saved["bind"], "10.0.0.10:8090")
            self.assertTrue(verify_password("next-one", saved["password_hash"]))
            self.assertFalse(verify_password("example", saved["password_hash"]))
            status, _, _ = panel.handle("GET", "/api/state", headers=other)
            self.assertEqual(status, 401)
            status, _, _ = panel.handle("GET", "/api/state", headers=cookie)
            self.assertEqual(status, 200)
