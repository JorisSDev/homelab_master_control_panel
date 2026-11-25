# Homelab Master Control Panel

A single-operator dashboard for Proxmox homelabs. It brings machine and storage health, resource usage, monitoring summaries, and maintenance history into one place. It can run configured maintenance jobs and perform selected administration tasks. It links to Proxmox and services such as Uptime Kuma for their dedicated workflows.

The panel runs on a Proxmox host. It requires sign-in and is intended for a trusted LAN and owner-restricted Tailscale access only. Keep it off the public internet.

## Install

You need a Proxmox VE host with systemd and Python 3.11 or newer. The example service runs as root so it can read Proxmox state and invoke host actions. Review your configuration, enabled actions, and network access before starting it.

### Download a release

Choose a version from [GitHub Releases](https://github.com/JorisSDev/homelab_master_control_panel/releases), replace `X.Y.Z` below, and run the following on the Proxmox host as root.

```sh
version=X.Y.Z
directory="/opt/homelab-panel/$version"
base="https://github.com/JorisSDev/homelab_master_control_panel/releases/download/v$version"

install -d "$directory" &&
curl -fsSL -o "$directory/homelab-panel.pyz" "$base/homelab-panel.pyz" &&
curl -fsSL -o "$directory/homelab-panel.pyz.sha256" "$base/homelab-panel.pyz.sha256" &&
(cd "$directory" && sha256sum -c homelab-panel.pyz.sha256) &&
ln -sfn "$directory" /opt/homelab-panel/current
```

### Configure the host

For a first install, start with [the example configuration](config.example.json) from the same release. Run these commands from the directory containing that example.

```sh
install -d -m 0700 /etc/homelab-panel /var/lib/homelab-panel &&
install -m 0600 config.example.json /etc/homelab-panel/config.json
```

- Set `bind` to one private `host:port` on your system. Set `state_dir` to `/var/lib/homelab-panel`.
- Replace or remove sample machine IDs, endpoints, and integration settings. Maintenance features require your own compatible services, timers, scripts, or logs. Check that the configured actions do what you expect before using them.
- Set a unique panel password before starting the service. This writes its hash to the config and keeps the password out of shell history.

```sh
python3 - <<'PY'
import getpass
import json
import sys
from pathlib import Path

sys.path.insert(0, "/opt/homelab-panel/current/homelab-panel.pyz")
from homelab_panel.auth import hash_password

path = Path("/etc/homelab-panel/config.json")
config = json.loads(path.read_text())
password = getpass.getpass("Panel password: ")
if not password or password != getpass.getpass("Confirm password: "):
    raise SystemExit("Passwords must be nonempty and match.")
config["password_hash"] = hash_password(password)
path.write_text(json.dumps(config, indent=2) + "\n")
PY
```

### Start the panel

Save this as `/etc/systemd/system/homelab-panel.service`.

```ini
[Unit]
Description=Homelab Master Control Panel
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 /opt/homelab-panel/current/homelab-panel.pyz --config /etc/homelab-panel/config.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Before enabling the service, restrict the listener to the intended private network and the authorized operator. The backend serves plain HTTP. For remote access, use an owner-restricted Tailscale route. The tailnet policy must permit only the intended owner access. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

```sh
systemctl daemon-reload &&
systemctl enable --now homelab-panel.service &&
systemctl status homelab-panel.service
```

Open the configured private address and sign in. Verify the expected version and confirm that the panel is inaccessible outside the authorized paths.

## Upgrade

Use **Install** on the System page, or run the following on the host. Both paths verify the release checksum and restart the panel service. Keep the previous version directory available for recovery.

```sh
python3 /opt/homelab-panel/current/homelab-panel.pyz --update --config /etc/homelab-panel/config.json
```
