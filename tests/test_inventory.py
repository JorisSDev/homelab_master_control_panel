import unittest

from homelab_panel.collect import collect_snapshot
from homelab_panel.inventory import parse_guest_services, parse_guest_table, parse_pvesm, parse_resources, parse_simulation, service_url


class InventoryTests(unittest.TestCase):
    def test_an_empty_lock_column_still_names_the_guest(self):
        text = "VMID       Status     Lock         Name\n108        running                 media\n"
        rows = parse_guest_table(text, "container")
        self.assertEqual(rows["108"], {"name": "media", "status": "running", "kind": "container"})

    def test_guest_disks_come_from_storage_status(self):
        text = "Name Type Status Total Used Available %\nguests zfspool active 1000 400 600 40.00%\n"
        rows = parse_pvesm(text)
        self.assertEqual(rows[0]["label"], "guests")
        self.assertEqual(rows[0]["free"], 600 * 1024)

    def test_simulation_counts_security_and_never_installs(self):
        text = "\n".join(
            [
                "Inst openssl [1] (2 Debian-Security:stable [amd64])",
                "Inst bash [1] (2 Debian:stable [amd64])",
                "Conf openssl",
            ]
        )
        parsed = parse_simulation(text)
        self.assertEqual(parsed["total"], 2)
        self.assertEqual(parsed["security"], 1)
        self.assertEqual(parsed["pending"], 1)
        self.assertEqual(
            parsed["upgrades"],
            [
                {"name": "openssl", "current": "1", "candidate": "2", "security": True},
                {"name": "bash", "current": "1", "candidate": "2", "security": False},
            ],
        )
        self.assertEqual(service_url("javascript:alert(1)", "10.0.0.30"), "")
        self.assertEqual(service_url(":32400/web", "10.0.0.30"), "http://10.0.0.30:32400/web")

    def test_resources_keep_present_numbers_only(self):
        text = """[
            {"vmid": 201, "name": "media", "status": "running", "type": "lxc", "cpu": 0.5, "mem": 10, "maxmem": 20, "disk": 30, "maxdisk": 40},
            {"vmid": 216, "name": "house", "status": "stopped", "type": "qemu", "cpu": false}
        ]"""
        rows = parse_resources(text)
        self.assertEqual(rows["201"]["kind"], "container")
        self.assertEqual(rows["201"]["cpu"], 0.5)
        self.assertEqual(rows["201"]["mem"], 10)
        self.assertEqual(rows["201"]["maxmem"], 20)
        self.assertEqual(rows["201"]["disk"], 30)
        self.assertEqual(rows["201"]["maxdisk"], 40)
        self.assertEqual(rows["216"]["kind"], "vm")
        self.assertNotIn("cpu", rows["216"])
        self.assertNotIn("mem", rows["216"])

    def test_inner_services_drop_noise_and_shorten_images(self):
        units = "\n".join(
            [
                "console-getty.service loaded active running",
                "container-getty@1.service loaded active running",
                "cron.service loaded active running",
                "dbus.service loaded active running",
                "ssh.service loaded active running",
                "postfix@-.service loaded active running",
                "systemd-journald.service loaded active running",
                "docker.service loaded active running",
                "containerd.service loaded active running",
                "nginx.service loaded active running",
            ]
        )
        images = "\n".join(
            [
                "web\tghcr.io/example/nextcloud:apache",
                "photos\tregistry.example/immich-server:v3",
            ]
        )
        self.assertEqual(parse_guest_services(units, images), ["nginx", "nextcloud:apache", "immich-server:v3"])
        self.assertEqual(parse_guest_services("nginx.service loaded active running\n", images), ["nginx"])
        self.assertEqual(parse_guest_services("", images), [])

    def test_upgrade_list_caps_around_three_hundred(self):
        lines = [f"Inst pkg{index} [1.0] (1.1 Debian:stable [amd64])" for index in range(305)]
        lines[0] = "Inst pkg0 [1.0] (1.1 Debian-Security:stable [amd64])"
        parsed = parse_simulation("\n".join(lines))
        self.assertEqual(parsed["total"], 305)
        self.assertEqual(parsed["security"], 1)
        self.assertEqual(len(parsed["names"]), 40)
        self.assertEqual(len(parsed["upgrades"]), 300)
        self.assertEqual(parsed["upgrades"][0]["candidate"], "1.1")
        self.assertTrue(parsed["upgrades"][0]["security"])
        self.assertFalse(parsed["upgrades"][1]["security"])

    def test_unmounted_storage_keeps_a_fictional_path(self):
        text = "\n".join(
            [
                "Name Type Status Total Used Available %",
                "root dir active 32000000 10000000 22000000 31.00%",
                "shelf dir inactive 0 0 0 0.00%",
            ]
        )
        note = "unable to activate storage 'shelf' - directory is expected to be a mount point but is not mounted: '/mnt/fictional-shelf'\n"
        rows = {row["label"]: row for row in parse_pvesm(text, note)}
        self.assertEqual(rows["shelf"]["status"], "inactive")
        self.assertEqual(rows["shelf"]["free"], 0)
        self.assertEqual(rows["shelf"]["detail"], "/mnt/fictional-shelf")
        self.assertEqual(rows["root"]["detail"], "")

    def test_note_callable_supplies_storage_stderr(self):
        def runner(command):
            if command == ["pvesm", "status"]:
                return "\n".join(
                    [
                        "Name Type Status Total Used Available %",
                        "shelf dir inactive 0 0 0 0.00%",
                    ]
                )
            return ""

        def note(command):
            self.assertEqual(command, ["pvesm", "status"])
            return "unable to activate storage 'shelf' - directory is expected to be a mount point but is not mounted: '/mnt/fictional-shelf'\n"

        snapshot = collect_snapshot({}, runner, lambda path: "", note)
        self.assertEqual(snapshot["storages"][0]["label"], "shelf")
        self.assertEqual(snapshot["storages"][0]["status"], "inactive")
        self.assertEqual(snapshot["storages"][0]["detail"], "/mnt/fictional-shelf")
