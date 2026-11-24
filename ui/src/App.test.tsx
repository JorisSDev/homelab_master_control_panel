import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { awayLines, machineMark, reorderIds } from "./lib";
import type { JobView, ViewState } from "./types";

const job = (over: Partial<JobView> = {}): JobView => ({
  purpose: "Purpose.",
  idle: true,
  status: "Idle",
  detail: "Last report: clean.",
  summary: "Last report: clean.",
  next: "Sun 04 Jan 06:00",
  note: "",
  started: "",
  elapsed: "",
  timeline: [],
  waiting: false,
  lock: "",
  history: [],
  security: null,
  pending: null,
  dry: false,
  last_result: "",
  ...over,
});

const fixture: ViewState = {
  refresh_seconds: 10,
  update: job({
    purpose: "Installs host packages and recreates Compose apps. It restarts playback.",
    detail: "Last report: dry run.",
    summary: "Last report: dry run.",
    security: 7,
    pending: 4,
    dry: true,
    last_result: "dry run",
    history: [
      {
        heading: "2026-01-02T03:04:05+00:00 · dry run · under a minute",
        ok: true,
        result: "dry run",
        steps: ["Guest 201 · Packages"],
        transcript: "=== homelab-update start ===",
        hidden_lines: 0,
      },
    ],
  }),
  scan: job({
    purpose: "Checks leftover files and runs ClamAV. It does not restart apps.",
    next: "Tue 02 Jan 04:00",
    history: [
      {
        heading: "2026-01-02T04:05:00+00:00 · 35 min",
        ok: true,
        result: "clean",
        steps: ["Guest 201 · Malware scan"],
        transcript: "scan clean",
        hidden_lines: 2,
      },
    ],
  }),
  health: {
    purpose: "Is the host itself all right.",
    status: "All right",
    summary: "Load 0.4",
    load: "0.40",
    memory_used: "8.0 GB",
    memory_total: "16.0 GB",
    disk_free: "20.0 GB",
    disk_total: "32.0 GB",
    disk_check: { next: "not scheduled", last: "no run yet" },
    housekeeping: [{ unit: "man-db.timer", next: "Wed 03 Jan 00:00", last: "Mon 01 Jan 00:00" }],
  },
  panel: { version: "dev", latest: "v0.4.0", update_available: true, error: "" },
  services: {
    purpose: "Configured guests and the services inside them.",
    status: "Needs a look",
    summary: "1 stopped",
    rows: [
      {
        id: "201",
        name: "media",
        kind: "container",
        status: "Running",
        url: "http://10.0.0.30:32400/web",
        services: ["nginx", "nextcloud:apache"],
        cpu: "12%",
        memory: "1.0 GB / 2.0 GB",
        disk: "3.0 GB / 8.0 GB",
      },
      {
        id: "216",
        name: "house",
        kind: "vm",
        status: "Stopped",
        url: "",
        services: [],
        cpu: "",
        memory: "",
        disk: "",
      },
    ],
  },
  storage: {
    purpose: "Free space on the host, the disk shelf, and the guest disks.",
    status: "Room to spare",
    summary: "20.0 GB free on /",
    rows: [{ label: "/", kind: "mount", free: "20.0 GB", total: "32.0 GB", status: "Room", low: false, detail: "" }],
  },
  findings: {
    purpose: "What the last scan or update left behind.",
    status: "1 finding",
    summary: "host example finding",
    count: 1,
    items: [
      {
        job: "scan",
        guest: "host",
        result: "host example finding",
        heading: "2026-01-02T04:00:00+00:00",
        transcript: "ISSUE host example finding",
        hidden_lines: 0,
      },
    ],
  },
  packages: { checked: false, total: null, security: null, pending: null, names: [], upgrades: [], error: "" },
  guest_updates: { checked: false, error: "", rows: [], active: "" },
};

function page(path: string, state: ViewState = fixture) {
  return renderToStaticMarkup(<App initial={state} live={false} initialPath={path} />);
}

describe("master panel", () => {
  it("opens on an overview that only rolls up the other pages", () => {
    const shown: ViewState = {
      ...fixture,
      calendar: {
        rules: [
          { label: "Scan", time: "04:00", weekdays: null },
          { label: "Update", time: "06:00", weekdays: [6] },
          { label: "Proxmox", time: "01:00", weekdays: null, until: "06:00" },
        ],
        standing: [],
      },
      week: [
        { unit: "homelab-scan.timer", label: "Daily scan", next: "Tue 02 Jan 04:00", soon: true },
        { unit: "homelab-update.timer", label: "Sunday update", next: "Sun 04 Jan 06:00", soon: true },
        { unit: "pve-daily-update.timer", label: "Proxmox package refresh", next: "Wed 03 Jan 02:00", soon: true },
        { unit: "logrotate.timer", label: "Log rotate", next: "Wed 03 Jan 00:00", soon: true },
      ],
      upcoming: [{ unit: "logrotate.timer", label: "Log rotate", next: "Wed 03 Jan 00:00", soon: true }],
      chronology: [{ text: "qmcreate 116 OK", href: "/guests/116" }],
      figures: {
        load: "1.20",
        memory_used: "8.0 GB",
        memory_total: "15.3 GB",
        memory_assigned: "20.5 GB",
        root_free: "20.0 GB",
        root_total: "32.0 GB",
        das_free: "100.0 GB",
        das_total: "200.0 GB",
        das_label: "/mnt/shelf",
      },
    };
    const html = page("/", shown);
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    for (const label of ["Overview", "Machines", "Reach", "Storage", "Jobs", "System"]) {
      expect(nav).toContain(`>${label}<`);
    }
    expect(nav).not.toContain(">Guests<");
    expect(nav).not.toContain(">Home<");
    expect(nav).not.toContain(">Findings<");
    expect(nav).not.toContain(">Recovery<");
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain("Master control panel");
    expect(html).toContain("host example finding");
    expect(html).toContain("Coming up");
    expect(html).toContain("Scan");
    expect(html).toContain("Tue 02 Jan 04:00");
    expect(html).toContain("Sunday update");
    expect(html).toContain("Sun 04 Jan 06:00");
    expect(html).toContain("Proxmox package refresh");
    expect(html).toContain("Last minute");
    expect(html).toContain("20.0 / 32.0 GB");
    expect(html).toContain(">free<");
    expect(html).toContain("100.0 / 200.0 GB");
    expect(html).toContain("20.5 / 15.3 GB");
    expect(html).toContain("assigned on this host");
    expect(html).toContain("Overcommitted");
    expect(html).not.toContain("Log rotate");
    expect(html).not.toContain("qmcreate");
    expect(html).not.toContain("assigned of");
    expect(html).toContain(">dev<");
    expect(html).not.toContain("VM 216");
    expect(html).not.toContain("nextcloud:apache");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    expect(html).not.toContain("apt-get install");
    const clear = page("/", {
      ...fixture,
      findings: { ...fixture.findings, count: 0, items: [] },
    });
    expect(clear).toContain("The house is clear.");
    const busy = page("/", { ...shown, scan: { ...shown.scan, idle: false, status: "Scan running" } });
    expect(busy).toContain("Scan running");
    expect(busy).toContain('href="/jobs/scan"');
  });

  it("shows the running scan in plain language and hides the start button", () => {
    const running: ViewState = {
      ...fixture,
      scan: job({
        purpose: "Checks leftover files and runs ClamAV. It does not restart apps.",
        idle: false,
        status: "Scan running",
        detail: "Malware scan on guest 201",
        summary: "Malware scan on guest 201",
        started: "04:05",
        elapsed: "5 min",
        lock: "The scan is using the maintenance lock. The update waits until it finishes.",
        timeline: [
          { text: "Guest 201 · Leftover files", current: false, guest: "", step: "", elapsed: "" },
          { text: "Guest 201 · Malware scan", current: true, guest: "201", step: "clamav", elapsed: "5 min" },
        ],
      }),
    };
    const html = page("/jobs/scan", running);
    expect(html).toContain("Scan running");
    expect(html).toContain("Malware scan on guest 201");
    expect(html).toContain("5 min");
    expect(html).toContain("step-current");
    expect(html).toContain(">Now<");
    expect(html).not.toContain("Run the scan");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
  });

  it("keeps the Sunday confirmation behind a second button", () => {
    const html = page("/jobs/update");
    expect(html.indexOf("Check for updates")).toBeLessThan(html.indexOf("Update all"));
    expect(html).toContain("Update all");
    expect(html).toContain("Check for updates");
    expect(html).toContain("Dry run");
    expect(html).toContain("Not checked.");
    expect(html).toContain("Next run");
    expect(html).toContain("Host packages");
    expect(html).toContain("Guest 201 · Packages");
    expect(html).not.toContain("Start the update");
    expect(html).not.toContain("Start the dry run");
    expect(html).not.toContain("restarts playback");
    expect(html).not.toContain("The last report was a dry run");
    expect(html).not.toContain("Asks what apt would upgrade");
    expect(html).not.toContain("Transcript");
    expect(html).not.toContain("=== homelab-update start ===");
    expect(html).not.toContain("apt-get install");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    const updating = page("/jobs/update", {
      ...fixture,
      guest_updates: { ...fixture.guest_updates, active: "201" },
    });
    expect(updating).toContain("media is updating");
    expect(updating).not.toContain("Start the update");
  });

  it("lists every guest and keeps a virtual machine free of an update button", () => {
    const html = page("/guests");
    expect(html).toContain("CT 201");
    expect(html).toContain("VM 216");
    expect(html).toContain("media");
    expect(html).toContain("house");
    expect(html).not.toContain(">Open<");
    expect(html).toContain("—");
    expect(html).toContain('aria-label="Move media up"');
    expect(html).toContain('aria-label="Move media down"');
    expect(html).not.toContain("nextcloud:apache");
    expect(html).toContain('aria-label="Filter"');
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    expect(html).not.toContain("apt-get install");
    const media = page("/guests/201");
    const house = page("/guests/216");
    expect(html).toContain("Machines");
    expect(html).toContain("Sort by");
    expect(html).toContain(">Boot<");
    expect(html).toContain(">Address<");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("the next time the host starts");
    expect(html).not.toContain("Nothing restarts now");
    expect(media).toContain("nextcloud:apache");
    expect(media).toContain('aria-label="Open media"');
    expect(media).toContain('href="http://10.0.0.30:32400/web"');
    expect(media).toContain('target="_blank"');
    expect(media).toContain('rel="noopener noreferrer"');
    expect(media).toContain("Update this machine");
    expect(media).toContain("Blast radius");
    expect(media).not.toContain("Start the machine update");
    expect(media).not.toContain("Update this guest");
    expect(house).not.toContain("Update this machine");
    const unsafe = page("/guests", {
      ...fixture,
      services: {
        ...fixture.services,
        rows: [{ ...fixture.services.rows[0], url: "javascript:alert(1)" }, fixture.services.rows[1]],
      },
    });
    expect(unsafe).not.toContain("javascript:");
    const mixed: ViewState = {
      ...fixture,
      services: {
        ...fixture.services,
        rows: [
          { ...fixture.services.rows[1], order: 2 },
          {
            id: "330",
            name: "spare",
            kind: "container",
            status: "Not reported",
            url: "",
            services: ["Custom"],
            cpu: "",
            memory: "",
            disk: "",
            order: 3,
          },
          { ...fixture.services.rows[0], order: 1 },
        ],
      },
    };
    const ordered = page("/guests", mixed);
    expect(ordered.indexOf("CT 201")).toBeLessThan(ordered.indexOf("VM 216"));
    expect(ordered.indexOf("VM 216")).toBeLessThan(ordered.indexOf("CT 330"));
    expect(reorderIds(["107", "201", "216"], "216", "107")).toEqual(["216", "107", "201"]);
    expect(reorderIds(["107", "201", "216"], "107", "216")).toEqual(["201", "216", "107"]);
    expect(reorderIds(["107", "201"], "107", "107")).toEqual(["107", "201"]);
    expect(reorderIds(["107", "201"], "999", "107")).toEqual(["107", "201"]);
    expect(machineMark("boot", 2, "")).toBe("2");
    expect(machineMark("address", 2, "10.0.0.30")).toBe("10.0.0.30");
    expect(machineMark("address", 2, "")).toBe("—");
  });

  it("shows package versions after a check and an empty result plainly", () => {
    const checked: ViewState = {
      ...fixture,
      packages: {
        checked: true,
        total: 2,
        security: 1,
        pending: 1,
        names: ["openssl", "bash"],
        error: "",
        upgrades: [
          { name: "openssl", current: "1.0", candidate: "1.1", security: true },
          { name: "bash", current: "2.0", candidate: "2.1", security: false },
        ],
      },
    };
    const html = page("/jobs/update", checked);
    expect(html).toContain("openssl");
    expect(html).toContain("1.0");
    expect(html).toContain("1.1");
    expect(html).toContain("Security");
    expect(html).toContain("Other");
    expect(html).toContain("row-security");
    expect(html).toContain("row-candidate");
    expect(html).not.toContain(">Install<");
    expect(html).not.toContain("apt-get install");
    const waiting: ViewState = {
      ...fixture,
      packages: { ...fixture.packages, checked: true, total: 0, security: 0, pending: 0 },
    };
    expect(page("/jobs/update", waiting)).toContain("Nothing is waiting.");
  });

  it("opens jobs on a month calendar and leaves housekeeping off it", () => {
    const html = page("/jobs", {
      ...fixture,
      week: [
        { unit: "logrotate.timer", label: "Log rotate", next: "Wed 03 Jan 00:00", soon: true },
        { unit: "systemd-tmpfiles-clean.timer", label: "systemd tmpfiles", next: "Wed 03 Jan 00:00", soon: true },
      ],
      calendar: {
        rules: [
          { label: "Scan", time: "04:00", weekdays: null },
          { label: "Update", time: "06:00", weekdays: [6] },
          { label: "Proxmox", time: "01:00", weekdays: null, until: "06:00" },
        ],
        standing: ["Disk check runs every two minutes."],
      },
    });
    expect(html).toContain("calendar-grid");
    expect(html.indexOf(">Mon<")).toBeLessThan(html.indexOf(">Sun<"));
    expect(html).toContain("Previous month");
    expect(html).toContain("Next month");
    expect(html).toContain("is-today");
    expect(html).toContain("Every day · Scan 04:00 · Proxmox 01:00–06:00");
    const cells = html.slice(html.indexOf("calendar-grid"));
    expect(cells).toContain("Update 06:00");
    expect(cells).not.toContain("Scan 04:00");
    expect(cells).not.toContain("Proxmox");
    expect(html).toContain("Disk check runs every two minutes.");
    expect(html).not.toContain("Log rotate");
    expect(html).not.toContain("systemd tmpfiles");
    expect(html).toContain("Skip next Sunday");
    expect(html).toContain("Move weekly time");
    expect(html).toContain("Schedule one run");
    expect(html).not.toContain("The coming Sunday update will not run");
    expect(html).not.toContain("Start the update");
    expect(html).not.toContain("restarts playback");
    const empty = page("/jobs", {
      ...fixture,
      week: [{ unit: "logrotate.timer", label: "Log rotate", next: "Wed 03 Jan 00:00", soon: false }],
      calendar: { rules: [], standing: [] },
    });
    expect(empty).toContain("No house jobs were read.");
    expect(empty).not.toContain("Log rotate");
    expect(empty).not.toContain("calendar-grid");
  });

  it("puts monitors on Reach, meters on Storage, and install behind a published release", () => {
    const rich: ViewState = {
      ...fixture,
      reach: {
        paths: [{ name: "Media", guest: "201", lan: "media.example", public: "media.example.com", lan_ok: true, public_ok: null, kuma: "up" }],
        monitors: { ok: true, error: "", summary: "1 up", rows: [{ name: "Media", type: "http", status: "up", at: "" }] },
        pins: { checked: true, summary: "1 pins match", rows: [{ id: "201", name: "media", ok: true }] },
        multicast_snooping: false,
        tunnel: { guest: "114", connections: 4, detail: "" },
        wan: { port: 32400, guest: "201", listening: true },
      },
      uptime_seconds: 120,
    };
    const reach = page("/reach", rich);
    expect(reach).toContain("Media");
    expect(reach).toContain("media.example");
    expect(reach).toContain("1 up, 0 down");
    expect(reach).toContain("24h");
    expect(reach).toContain("7d");
    expect(reach).toContain("Last down");
    expect(reach).toContain("Last down is within 30 days.");
    expect(reach).toContain("—");
    expect(reach).toContain("1 pins match");
    expect(reach).toContain("Multicast snooping");
    expect(reach).toContain("is off");
    expect(reach).toContain("listening");
    expect(reach).not.toContain("Public");
    expect(reach).not.toContain("Open Kuma");
    expect(reach).not.toContain("api/push");
    const linked = page("/reach", {
      ...rich,
      reach: {
        ...rich.reach!,
        kuma_url: "http://10.0.0.41:3001",
        monitors: {
          ok: true,
          error: "",
          summary: "1 up, 1 down",
          rows: [
            { name: "Media", type: "http", status: "up", at: "2026-11-24 12:00:00", uptime_24h: 99.5, uptime_7d: 98, last_down: "" },
            { name: "Photos", type: "ping", status: "down", at: "", uptime_24h: null, uptime_7d: 90.5, last_down: "2026-11-24 20:53:53.225" },
          ],
        },
      },
    });
    expect(linked).toContain("1 up, 1 down");
    expect(linked).toContain("99.5%");
    expect(linked).toContain("98.0%");
    expect(linked).toContain("90.5%");
    expect(linked).toContain("24 Nov 20:53");
    expect(linked).toContain("Last down is within 30 days.");
    expect(linked).toContain("Open Kuma");
    expect(linked).toContain('href="http://10.0.0.41:3001"');
    expect(linked).toContain('target="_blank"');
    expect(linked).toContain('rel="noopener noreferrer"');
    expect(linked).toContain("media.example");
    const unsafe = page("/reach", {
      ...rich,
      reach: { ...rich.reach!, kuma_url: "javascript:alert(1)" },
    });
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).not.toContain("Open Kuma");
    const storage = page("/storage");
    expect(storage).toContain("Run disk check");
    expect(storage).toContain("Nothing is backed up. There is no backup job, and no machine has a second copy.");
    expect(storage).not.toContain("<th>Where</th>");
    expect(storage).toContain("20.0 / 32.0 GB");
    expect(storage).toContain(">free<");
    const copied = page("/storage", {
      ...fixture,
      protection: {
        has_job: false,
        rows: [{ name: "media", id: "201", backup: "No job", snapshot: "None", copy: "Photos live on the shelf." }],
      },
      das: {
        expected_uuid: "abc",
        mounted_uuid: "def",
        speeds: ["6.0 Gb/s"],
        faults: 2,
        recent: [],
        smart: "",
        fstab_waits: true,
        summary: "The shelf is mounted.",
        match: "No expected disk",
      },
    });
    expect(copied).toContain("Photos live on the shelf.");
    expect(copied).toContain("<th>Where</th>");
    expect(copied).toContain("The shelf is mounted.");
    expect(copied).toContain("6.0 Gb/s");
    expect(copied).toContain("2 bus errors.");
    expect(copied).toContain("fstab waits for the disk.");
    const system = page("/system");
    expect(system).toContain("Install this version");
    expect(system).toContain("Sign out");
    expect(system).toContain("v0.4.0");
    const current = page("/system", { ...fixture, panel: { ...fixture.panel, update_available: false } });
    expect(current).not.toContain("Install this version");
    expect(current).toContain("Sign out");
    expect(page("/", rich)).toContain("Open the recovery checklist");
  });

  it("describes what changed since the last visit", () => {
    const before = {
      scan: "clean",
      update: "idle",
      guests: "201:Running",
      monitors: "Media:up",
      disk: "20 GB",
      event: "",
    };
    const after = { ...before, scan: "finding", monitors: "Media:down", event: "Scan finished" };
    expect(awayLines(before, after)).toEqual(["Scan is now finding", "A monitor changed.", "Scan finished"]);
    expect(awayLines(before, before)).toEqual([]);
  });
});
