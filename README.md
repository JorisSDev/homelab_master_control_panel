# Homelab maintenance panel

A local control panel for the jobs a Proxmox host already runs. The page is called Master control panel. Home is the logo. Findings are on that page, with the running guests and a line for the next scan, the next update, storage, and this panel. Sign in is required. It can start the scan, and it can start the Sunday update after a confirmation that says the update restarts playback. Check for updates does not install anything. Update on a row upgrades that container. It cannot stop a guest, change the firewall, or move the timers.

The runtime is Python 3 from the standard library. The page is a React application, built ahead of time and packed into the same zipapp. The host does not need Node, a virtualenv, or another container.

## Sections

- **Home.** The logo opens this page. Findings are on that page. A status line opens the next scan, the next update, storage, and the panel version. Running guests are listed under that.
- **Containers.** Each configured guest, its status, and the services running inside it. A name with an address is a link. Filter matches a name, an id, or a service.
- **Storage.** Free space on the host mounts and the guest disks. A mount that is filling up is called out. An unmounted disk is listed as not mounted.
- **Update.** Lists each guest. Host packages stay in a closed disclosure. Check for updates does not install. Update on a row upgrades that container. Update all is still the Sunday job.
- **Scan.** Checks leftover files and runs ClamAV. It does not restart apps.
- **Panel.** The installed version, the latest GitHub release, and Install when they differ. Sign out is here.

Check for updates runs only when you press the button. Refresh does not simulate an upgrade or check a guest.

## What the page reads

The process binds to the single address in its config. It refuses `0.0.0.0` and `::`. It reads systemd timers, the maintenance logs, load, memory, disk space, and an optional event file. UI paths and timer notes live in the config file, which stays on the host.

`config.example.json` uses fictional addresses. Copy it and replace the values. Do not commit a config that names a real network.

## Event lines

The update and scan jobs can append one JSON object per line. There is no schema version field. Each object has:

- `ts` — local ISO-8601 time
- `job` — `update` or `scan`
- `kind` — `start`, `step`, `fail`, or `end`

These fields are present only when that call recorded them: `guest`, `step`, `dry`, `result`, `detail`, `message`.

Broken lines are skipped. When a run has step events inside its start and end, those steps replace the log markers. The log stays available as the transcript.

## Develop

The listen address is `BIND` in `.env`. Copy `.env.example` to `.env` and change that line. It overrides the fictional address in `config.example.json`. An empty value, `0.0.0.0`, and `::` are still refused.

```sh
cd ui
npm ci
npm test
npm run dev
```

`npm run dev` starts the API and the page. Open the URL it prints. The example password is `example`.

## Release

Tag `vX.Y.Z`. GitHub Actions tests the parsers and the page, builds the UI, and publishes `homelab-panel.pyz` with its sha256. The tag is written into that zipapp.

The first install of a release uses the published file. Check the sha256, keep the previous directory, and point the service at the new file.

```sh
install -d /opt/homelab-panel/X.Y.Z
curl -fsSL -o /opt/homelab-panel/X.Y.Z/homelab-panel.pyz \
  https://github.com/JorisSDev/homelab_master_control_panel/releases/download/vX.Y.Z/homelab-panel.pyz
curl -fsSL -o /opt/homelab-panel/X.Y.Z/homelab-panel.pyz.sha256 \
  https://github.com/JorisSDev/homelab_master_control_panel/releases/download/vX.Y.Z/homelab-panel.pyz.sha256
sha256sum -c homelab-panel.pyz.sha256
printf '%s\n' vX.Y.Z > /var/lib/homelab-panel/installed-version
ln -sfn /opt/homelab-panel/X.Y.Z /opt/homelab-panel/current
```

After that copy is running, a newer release installs from the Panel page or with one command. Both use the same installer. It checks the sha256, keeps the previous directory, and restarts only the panel service.

```sh
python3 /opt/homelab-panel/current/homelab-panel.pyz --update
```

The service runs `/usr/bin/python3` on the zipapp with `--config` pointing at the host config. The host config names `scan_unit`, `update_unit`, and `password_hash`. Set `PASSWORD` in the environment to replace the example hash at startup. The page is HTTP on one LAN address, so the sign-in protects the actions from the rest of the network rather than from someone who can already read that address.
