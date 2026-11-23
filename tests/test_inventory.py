import unittest

from homelab_panel.inventory import parse_guest_table, parse_pvesm, parse_simulation, service_url


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
        self.assertEqual(service_url("javascript:alert(1)", "10.0.0.30"), "")
        self.assertEqual(service_url(":32400/web", "10.0.0.30"), "http://10.0.0.30:32400/web")
