# Master control panel

The LAN page for the Proxmox root administrator. It gathers the facts that otherwise take a terminal, and it runs the routine actions behind those facts. Sign-in is required. The process binds to one address and refuses `0.0.0.0` and `::`.

Proxmox remains the place to start, stop, open a console, snapshot, and firewall a guest. Each service keeps its own web application. Uptime Kuma remains the place to add and edit monitors. This panel links to those tools and shows their current result.

## Pages

- **Overview.** What needs a person, what changed since the last visit, four host figures, the next two days, a job that is running, and a short chronology.
- **Guests.** Every container and virtual machine, in boot order or by address. A guest opens a dossier with its resources, blast radius, and links out.
- **Reach.** LAN name, public name, and the latest Uptime Kuma result on one row. Pinned rows cover the tunnel, the WAN port, DNS pins, and multicast snooping.
- **Storage.** Free space, the disk-shelf dossier, and the protection matrix.
- **Jobs.** The month calendar, the security scan, and the Sunday update preview.
- **System.** The installed version, Install, the operator log, a redacted report, and Sign out. It opens from the version in the sidebar.
- **Recovery.** A live checklist at `/recovery`, offered after a short uptime. It is not in the sidebar.

Paths are `/`, `/guests`, `/guests/<id>`, `/reach`, `/storage`, `/jobs`, `/jobs/scan`, `/jobs/update`, `/recovery`, and `/system`.

## Actions

- Run the scan. It does not restart applications.
- Check pending packages. The check does not install anything.
- Update one running container after confirmation.
- Start the Sunday update after a confirmation that names the effect: packages install, Compose apps are recreated, playback restarts when that is what the host job does, and there is no vzdump rollback while no backup job exists.
- Dry-run the Sunday update when `update_script` is set.
- Run the disk check when `disk_unit` is set.
- Check DNS pins and service paths.
- Install a newer panel release.

The panel does not start or stop a guest, open a shell, or edit the firewall.

## What the page reads

systemd timers, the maintenance logs, load, memory, disk space, guest configs, and an optional event file. UI paths and timer notes live in the config file on the host.

`config.example.json` uses fictional addresses. Copy it and replace the values. Do not commit a config that names a real network.

Optional keys, all safe to omit:

- `roles` maps a guest id to a short role.
- `paths` lists `{name, guest, lan, public}` for the Reach table.
- `kuma.guest_id` is the container whose local Uptime Kuma database is read. The query asks for the monitor name, type, status, latest heartbeat, 24-hour and 7-day uptime, and last down time.
- `kuma.url` is an optional http(s) address shown as Open Kuma. It is not used to read the database.
- `das.uuid`, `das.mount`, and `das.monitor` describe the disk shelf.
- `disk_unit` is the systemd unit for Run disk check.
- `tunnel.guest_id` is the container that runs cloudflared.
- `wan.port` and `wan.guest_id` name the intentional WAN listener.
- `update_script` is the absolute path of the Sunday script, used for a dry run.
- `scan_coverage` is a list of sentences shown beside a scan result.
- `single_copy` is a list of `{id, note}` for data that has no second copy.
- `state_dir` stores the last package check and the operator log. A relative path is next to the config file.

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

After that copy is running, a newer release installs from System or with one command. Both use the same installer. It checks the sha256, keeps the previous directory, and restarts only the panel service.

```sh
python3 /opt/homelab-panel/current/homelab-panel.pyz --update
```

The service runs `/usr/bin/python3` on the zipapp with `--config` pointing at the host config. The host config names `scan_unit`, `update_unit`, and `password_hash`. Set `PASSWORD` in the environment to replace the example hash at startup. The page is HTTP on one LAN address, so the sign-in protects the actions from the rest of the network rather than from someone who can already read that address.
