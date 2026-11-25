import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { awayLines, machineMark, reorderIds } from "./lib";
import type { JobView, ViewState } from "./types";

const job = (over: Partial<JobView> = {}): JobView => ({
  purpose: "Purpose.",
  idle: true,
  status: "Idle",
  detail: "Last report: clean.",
  summary: "Last report: clean.",
  next: "2026-01-04 06:00",
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
        heading: "2026-01-02 03:04 · dry run · under a minute",
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
        heading: "2026-01-02 04:05 · 35 min",
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
        heading: "2026-01-02 04:00",
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
        { unit: "homelab-scan.timer", label: "Daily scan", next: "2026-01-02 04:00", soon: true },
        { unit: "homelab-update.timer", label: "Sunday update", next: "2026-01-04 06:00", soon: true },
        { unit: "pve-daily-update.timer", label: "Proxmox package refresh", next: "2026-01-03 02:00", soon: true },
        { unit: "logrotate.timer", label: "Log rotate", next: "2026-01-03 00:00", soon: true },
      ],
      upcoming: [{ unit: "logrotate.timer", label: "Log rotate", next: "Wed 03 Jan 00:00", soon: true }],
      chronology: [{ text: "qmcreate 116 OK", href: "/guests/116" }],
      figures: {
        load: "1.20",
        cores: 4,
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
    const nav = new DOMParser().parseFromString(html, "text/html").querySelector('[aria-label="Main navigation"]')?.innerHTML || "";
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
    expect(html).toContain("2026-01-02 04:00");
    expect(html).toContain("Sunday update");
    expect(html).toContain("2026-01-04 06:00");
    expect(html).toContain("Proxmox package refresh");
    expect(html).toContain("30%");
    expect(html).toContain("Load 1.20 on 4 cores");
    expect(html).toContain("Internal");
    expect(html).toContain("External");
    expect(html).toContain("12.0 / 32.0 GB");
    expect(html).toContain(">used<");
    expect(html).toContain("100.0 / 200.0 GB");
    expect(html).toContain("8.0 / 15.3 GB");
    expect(html).toContain("in use");
    expect(html).toContain("20.5 GB assigned");
    expect(html).toContain("Overcommitted");
    expect(html).toContain("1 running");
    expect(html).not.toContain("Last minute");
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
    expect(clear).toContain("No issues reported");
    const busy = page("/", { ...shown, scan: { ...shown.scan, idle: false, status: "Scan running" } });
    expect(busy).toContain("Scan running");
    expect(busy).toContain('href="/jobs/scan"');
  });

  it("distinguishes missing health readings, measured CPU, and capacity units", () => {
    const shown: ViewState = {
      ...fixture,
      observed_at: "2026-01-02T15:05:00",
      attention: [{ severity: "unknown", text: "Machine status is unavailable.", href: "/guests" }],
      health: { ...fixture.health, load: "0.40", cores: 4, cpu_usage: 0, disk_free: "256 MB", disk_total: "1.0 TB" },
    };
    const html = page("/", shown);
    expect(html).toContain("Health data incomplete");
    expect(html).toContain('dateTime="2026-01-02T15:05:00">2026-01-02 15:05</time>');
    expect(html).toContain("CPU usage");
    expect(html).toContain(">0%<");
    expect(html).toContain("Load 0.40 on 4 cores");
    expect(html).toContain("1023.8 GB / 1.0 TB");
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(Number(document.querySelector('[aria-label="Internal in use"]')?.getAttribute("aria-valuenow"))).toBeGreaterThan(99);
    const missing = page("/", { ...shown, health: { ...shown.health, load: "", cpu_usage: null } });
    expect(missing).toContain("Load unavailable");
    expect(missing).not.toContain(">0%<");
  });

  it("exposes past runs and keeps logs out of collapsed rows", () => {
    const older = { heading: "2026-01-01 04:00", started_at: "2026-01-01T04:00:00Z", ok: false, result: "incomplete", steps: [], transcript: "Earlier run log", hidden_lines: 0 };
    const html = page("/jobs/history", { ...fixture, scan: { ...fixture.scan, history: [...fixture.scan.history, older] } });
    const document = new DOMParser().parseFromString(html, "text/html");
    const scan = document.querySelector('[aria-label="Scan history"]');
    const update = document.querySelector('[aria-label="Full update history"]');
    expect(scan?.querySelectorAll("details:not([open])")).toHaveLength(2);
    expect(scan?.querySelector("time")?.dateTime).toBe(older.started_at);
    expect(scan?.textContent).toContain("Incomplete");
    expect(scan?.textContent).not.toContain("Earlier run log");
    expect(update?.textContent).toContain("Completed");
    expect(update?.textContent).toContain("dry run");
  });

  it("retains the last snapshot during a refresh failure and recovers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture))));
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () => root.render(<App />));
      expect(element.textContent).toContain("Could not read the panel");
      await act(async () => vi.advanceTimersByTimeAsync(10000));
      expect(element.textContent).toContain("host example finding");
      await act(async () => vi.advanceTimersByTimeAsync(10000));
      expect(element.textContent).toContain("Showing the last good snapshot");
      expect(element.textContent).toContain("host example finding");
      await act(async () => vi.advanceTimersByTimeAsync(10000));
      expect(element.textContent).not.toContain("Refresh failed");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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

  it("separates package checks from the full stack update and its confirmation", () => {
    const html = page("/jobs/update");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const checks = new DOMParser().parseFromString(page("/jobs/patches"), "text/html").querySelector("#patch-checks")?.textContent;
    const update = doc.querySelector("#update-job")?.textContent;
    expect(checks).toContain("Check packages");
    expect(checks).toContain("Host packages");
    expect(checks).toContain("Not checked");
    expect(checks).not.toContain("Run full update");
    expect(update).toContain("Run full update");
    expect(update).toContain("Preview full update");
    expect(update).toContain("Next run");
    expect(update).not.toContain("Check packages");
    expect(html).not.toContain("Start full update");
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
    expect(updating).not.toContain("Start full update");
  });

  it("shows recorded patch candidates separately from missing coverage", () => {
    const base = fixture.services.rows[0];
    const state: ViewState = {
      ...fixture,
      services: { ...fixture.services, rows: [
        ...fixture.services.rows,
        { ...base, id: "221", name: "Photos" },
        { ...base, id: "222", name: "New container" },
      ] },
      packages: { ...fixture.packages, checked: true, total: 0, security: 0, pending: 0 },
      guest_updates: { ...fixture.guest_updates, checked: true, rows: [
        { id: "201", packages: 3, security: 2, error: "", compose: [], floating: false },
        { id: "221", packages: 0, security: 0, error: "The check did not finish.", compose: [], floating: false },
      ] },
      plex: { id: "201", version: "1.2.1", minimum: "1.2.3", version_status: "below", ok: false, claimed: "1", render: "ok" },
    };
    const overview = page("/", state);
    expect(overview).toContain("Patch status");
    expect(overview).toContain('href="/jobs/patches"');
    expect(overview).toContain("No candidates reported");
    expect(overview).toContain("2 security · 1 other");
    expect(overview).toContain("1 of 3 running containers reported");
    expect(overview).toContain("Plex below minimum");
    const jobs = page("/jobs/patches", state);
    expect(jobs).toContain("Check incomplete");
    expect(jobs).toContain("The check did not finish.");
    expect(jobs).toContain("Outside container check");
    expect(jobs).toContain("Not checked");
    expect(jobs).toContain("Configured minimum");
    expect(jobs).not.toContain("Nothing is waiting");
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
    expect(html).toContain('aria-label="Filter machines"');
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    expect(html).not.toContain("apt-get install");
    const media = page("/guests/201");
    const house = page("/guests/216");
    expect(html).toContain("Machines");
    expect(html).toContain("Sort by");
    expect(html).toContain(">Boot order<");
    expect(html).toContain(">Address<");
    expect(html).not.toContain(">Save boot order<");
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
    const html = page("/jobs/patches", checked);
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
    const emptyResult = page("/jobs/patches", waiting);
    expect(emptyResult).toContain("No candidates reported");
    expect(emptyResult).toContain("0 of 1 running containers reported");
  });

  it("opens jobs on a month calendar and leaves housekeeping off it", () => {
    const html = page("/jobs/schedule", {
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
    expect(html).toContain('aria-label="pirmadienis">pr<');
    expect(html.indexOf(">pr<")).toBeLessThan(html.indexOf(">sk<"));
    expect(html).toContain("Previous month");
    expect(html).toContain("Next month");
    expect(html).toContain('aria-current="date"');
    const cells = html.slice(html.indexOf("calendar-grid"), html.indexOf("data-rail"));
    expect(cells).toContain("<button");
    expect(cells).toContain("06:00");
    expect(cells).not.toContain("Scan");
    expect(cells).not.toContain("Proxmox");
    expect(html).toContain("Every day");
    expect(html).toContain("Scan");
    expect(html).toContain("04:00");
    expect(html).toContain("Proxmox");
    expect(html).toContain("01:00–06:00");
    expect(html).toContain("Disk check runs every two minutes.");
    expect(html).not.toContain("Log rotate");
    expect(html).not.toContain("systemd tmpfiles");
    expect(html).not.toContain("Skip next Sunday");
    expect(html).not.toContain("Move weekly time");
    expect(html).not.toContain("Schedule one run");
    expect(html).not.toContain("The coming Sunday update will not run");
    expect(html).not.toContain("Start the update");
    expect(html).not.toContain("restarts playback");
    const empty = page("/jobs/schedule", {
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
    expect(reach).toContain("Last down covers the past 30 days.");
    expect(reach).toContain("—");
    expect(reach).toContain("1 pins match");
    expect(reach).toContain("Multicast snooping");
    expect(reach).toMatch(/Multicast snooping<\/dt><dd>Off/);
    expect(reach).toContain("Listening");
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
    expect(linked).toContain("2026-11-24 20:53");
    expect(linked).toContain("Last down covers the past 30 days.");
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
    expect(storage).toContain("No protection records are available.");
    expect(storage).not.toContain(">Where<");
    expect(storage).toContain("12.0 / 32.0 GB");
    expect(storage).toContain(">used<");
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
    expect(copied).toContain(">Where<");
    expect(copied).toContain("External storage");
    expect(copied).toContain("The shelf is mounted.");
    expect(copied).toContain("6.0 Gb/s");
    expect(copied).toMatch(/Bus errors<\/dt><dd class="num">2<\/dd>/);
    expect(copied).toContain("fstab waits for the disk.");
    const backups = page("/storage", { ...fixture, protection: { has_job: true, coverage_complete: false, rows: [
      { id: "201", name: "media", backup: "Scheduled", snapshot: "None", copy: "", backup_exclusions: true,
        next_backup: 1800000000, backup_destinations: ["vault"], latest_backup: { at: 1790000000, storage: "vault" }, archives_complete: false },
      { id: "208", name: "requests", backup: "Schedule unknown", snapshot: "None", copy: "", archives_complete: true },
    ] } });
    expect(backups).toContain("Some volumes excluded");
    expect(backups).toContain("Partial listing");
    expect(backups).toContain("Schedule unknown");
    expect(backups).toContain("No archive found");
    const system = page("/system");
    expect(system).toContain("Install this version");
    expect(system).toContain("Sign out");
    expect(system).toContain("v0.4.0");
    expect(system).toContain("Latest GitHub release");
    const current = page("/system", { ...fixture, panel: { ...fixture.panel, update_available: false } });
    expect(current).not.toContain("Install this version");
    expect(current).toContain("Sign out");
    const ahead = page("/system", { ...fixture, panel: { ...fixture.panel, version: "v0.14.10", latest: "v0.14.2", update_available: false } });
    expect(ahead).toContain("This panel is running a newer build than the latest GitHub release.");
    expect(ahead).not.toContain("Install this version");
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

type WriteRequest = { url: string; payload?: unknown };

async function exercisePanel(
  path: string,
  test: (panel: HTMLElement, writes: WriteRequest[]) => Promise<void>,
  state: ViewState = fixture,
  mode: "snapshot" | "signed-out" = "snapshot",
) {
  const writes: WriteRequest[] = [];
  const panel = document.createElement("div");
  document.body.appendChild(panel);
  const root = createRoot(panel);
  const originalPath = window.location.pathname;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      writes.push({ url: input, payload: typeof options.body === "string" ? JSON.parse(options.body) : undefined });
      if (input === "/api/login") return Response.json({ error: "Incorrect password." }, { status: 401 });
      if (input === "/api/maintenance/security/preview") {
        return Response.json({
          id: "fixture-review", target: "security", available: true, blocker: "",
          checked_at: "2026-11-25T10:00:00Z", expires_at: "2026-11-25T10:30:00Z",
          backup: null, packages: [{ name: "curl", current: "1.0", candidate: "1.1", critical: false }],
        });
      }
      return Response.json({ ok: true }, { status: 202 });
    }
    return mode === "signed-out" ? new Response(null, { status: 401 }) : Response.json(state);
  }));
  try {
    if (mode === "signed-out") window.history.replaceState(null, "", path);
    await act(async () => root.render(<App initialPath={path} initial={mode === "snapshot" ? state : null} live={mode === "signed-out"} />));
    await test(panel, writes);
  } finally {
    await act(async () => root.unmount());
    window.history.replaceState(null, "", originalPath);
    panel.remove();
    vi.unstubAllGlobals();
  }
}

function control(label: string, root: ParentNode = document) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => (item.getAttribute("aria-label") || item.textContent?.trim()) === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

async function press(element: HTMLElement | null) {
  if (!element) throw new Error("Missing control");
  await act(async () => element.click());
}

function enter(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Missing input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("redesigned workflows", () => {
  it("shows the decision view by default and keeps risky operations behind review", async () => {
    const state: ViewState = {
      ...fixture,
      packages: { ...fixture.packages, checked: true, security: 0 },
      maintenance: {
        security: { id: "security", name: "Host security", can_preview: true, blocker: "", backup: null,
          last_run: null, automation: "paused" },
        apps: [], legacy_paused: true, active: false,
      },
    };
    await exercisePanel("/jobs", async (panel, writes) => {
      expect(panel.textContent).toContain("No security candidates in the last check");
      expect(panel.querySelector(".calendar-grid")).toBeNull();
      await press(control("Review host patches", panel));
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Target is the Proxmox host");
      await press(control("Cancel", document.querySelector('[role="dialog"]')!));
      expect(writes).toEqual([{ url: "/api/maintenance/security/preview", payload: {} }]);
      await press(control("Review host patches", panel));
      await press(control("Install host patches", document.querySelector('[role="dialog"]')!));
      expect(writes.at(-1)).toEqual({ url: "/api/maintenance/security/apply", payload: { plan_id: "fixture-review", confirm: true } });
      await press(panel.querySelector('nav[aria-label="Job views"] a[href="/jobs/schedule"]'));
      expect(panel.textContent).toContain("The legacy full update is on hold");
      expect(panel.textContent).not.toContain("Run full update");
    }, state);
  });

  it("keeps navigation and reports accessible without dispatching an action", async () => {
    await exercisePanel("/", async (panel, writes) => {
      expect(panel.querySelector('a[href="/api/report"]')?.textContent).toBe("Report");
      await press(panel.querySelector('a[href="/jobs/patches"]'));
      expect(panel.querySelector('#patch-checks [aria-label="Machine package coverage"]')).not.toBeNull();
      expect(writes).toEqual([]);
      await press(control("More", panel));
      const sheet = document.querySelector('[aria-label="More pages"]');
      expect(sheet).not.toBeNull();
      await press(sheet?.querySelector('a[href="/storage"]') as HTMLElement);
      expect(panel.querySelector("h1")?.textContent).toBe("Storage");
      await press(panel.querySelector('[aria-label="Main navigation"] a[href="/guests"]'));
      await press(panel.querySelector('main a[href="/guests/201"]'));
      expect(panel.querySelector(".machine-detail h2")?.textContent).toBe("media");
      await press(control("Update this machine", panel));
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("can recreate its Compose services");
      await press(control("Cancel", document.querySelector('[role="dialog"]')!));
      expect(writes).toEqual([]);
    });
  });

  it("sends boot order only after an explicit confirmation", async () => {
    await exercisePanel("/guests", async (panel, writes) => {
      await press(control("Move house up", panel));
      await press(control("Save boot order", panel));
      await press(control("Cancel", document.querySelector('[role="dialog"]')!));
      expect(writes).toEqual([]);
      await press(control("Save boot order", panel));
      await press(control("Save", document.querySelector('[role="dialog"]')!));
      expect(writes).toEqual([{ url: "/api/guests/order", payload: { confirm: true, ids: ["216", "201"] } }]);
    });
  });

  it("requires confirmation to schedule an update and retains the original payload", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25, 11));
    const scheduled: ViewState = {
      ...fixture,
      calendar: { rules: [{ label: "Update", weekdays: [6], time: "06:00" }], standing: [] },
    };
    try {
      await exercisePanel("/jobs/schedule", async (panel, writes) => {
        const day = () => panel.querySelector<HTMLButtonElement>('button[data-date="2026-11-26"]');
        expect(day()?.getAttribute("aria-label")).toBe("2026 m. lapkričio 26 d., ketvirtadienis");
        await press(day());
        await press(control("Schedule one run"));
        await press(control("Cancel", document.querySelector(".dialog-surface")!));
        expect(writes).toEqual([]);
        await press(day());
        await press(control("Schedule one run"));
        await press(control("Schedule one run", document.querySelector(".dialog-surface")!));
        expect(writes).toEqual([{ url: "/api/jobs/update/schedule", payload: { confirm: true, action: "once", date: "2026-11-26", time: "06:00" } }]);
      }, scheduled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the scan, package check, dry run, and update requests", async () => {
    await exercisePanel("/jobs/update", async (panel, writes) => {
      await press(control("Preview full update", panel));
      expect(document.querySelector(".dialog-surface")?.textContent).toContain("refresh package lists");
      await press(control("Cancel", document.querySelector(".dialog-surface")!));
      await press(control("Run full update", panel));
      await press(control("Cancel", document.querySelector(".dialog-surface")!));
      expect(writes).toEqual([]);
      await press(panel.querySelector('nav[aria-label="Job views"] a[href="/jobs/scan"]'));
      await press(control("Run the scan", panel));
      await press(panel.querySelector('nav[aria-label="Job views"] a[href="/jobs"]'));
      await press(control("Check packages", panel));
      await press(panel.querySelector('nav[aria-label="Job views"] a[href="/jobs/schedule"]'));
      await press(control("Preview full update", panel));
      await press(control("Start the dry run", document.querySelector(".dialog-surface")!));
      await press(control("Run full update", panel));
      await press(control("Start full update", document.querySelector(".dialog-surface")!));
      expect(writes).toEqual([
        { url: "/api/actions/scan" },
        { url: "/api/packages/check" },
        { url: "/api/guests/check" },
        { url: "/api/actions/update", payload: { confirm: true, dry: true } },
        { url: "/api/actions/update", payload: { confirm: true } },
      ]);
    });
  });

  it("keeps rejected sign-in feedback in the form and sends the remember choice", async () => {
    await exercisePanel("/", async (panel, writes) => {
      await act(async () => {
        enter(panel.querySelector('input[name="password"]'), "fixture-password");
        panel.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      });
      await press(control("Sign in", panel));
      expect(panel.querySelector("#sign-in-error")?.textContent).toBe("Incorrect password.");
      expect(panel.querySelector('input[name="password"]')?.getAttribute("aria-invalid")).toBe("true");
      expect(writes).toEqual([{ url: "/api/login", payload: { password: "fixture-password", remember: true } }]);
    }, fixture, "signed-out");
  });
});

describe("remaining host action contracts", () => {
  it.each([
    ["skip", false, "Skip this one", { confirm: true, action: "skip", weekday: 6 }],
    ["restore", true, "Put it back", { confirm: true, action: "restore" }],
    ["move", false, "Move weekly time", { confirm: true, action: "move", weekday: 6, time: "17:30" }],
  ] as const)("retains the %s schedule operation", async (operation, skipped, confirmLabel, payload) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25, 11));
    const state: ViewState = {
      ...fixture,
      calendar: { rules: [{ label: "Update", weekdays: [6], time: "06:00" }], standing: [] },
      schedule: { skip: skipped ? "2026-11-29" : "", weekly: null, once: "", once_time: "" },
    };
    try {
      await exercisePanel("/jobs/schedule", async (panel, writes) => {
        await press(panel.querySelector('button[data-date="2026-11-29"]'));
        expect(writes).toEqual([]);
        if (operation === "move") {
          const input = document.querySelector<HTMLInputElement>('.popover-surface input[name="time"]');
          await act(async () => enter(input, "24:00"));
          expect(control("Save", document.querySelector(".popover-surface")!).disabled).toBe(true);
          await act(async () => enter(input, "17:30"));
          await press(control("Save", document.querySelector(".popover-surface")!));
        } else {
          await press(control(confirmLabel, document.querySelector(".popover-surface")!));
        }
        expect(writes).toEqual([]);
        await press(control(confirmLabel, document.querySelector(".dialog-surface")!));
        expect(writes).toEqual([{ url: "/api/jobs/update/schedule", payload }]);
      }, state);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves diagnostic, disk, release, and password controls", async () => {
    await exercisePanel("/reach", async (panel, writes) => {
      await press(control("Check paths", panel));
      await press(control("Check DNS pins", panel));
      await press(panel.querySelector('[aria-label="Main navigation"] a[href="/storage"]'));
      await press(control("Run disk check", panel));
      await press(panel.querySelector('[aria-label="Main navigation"] a[href="/system"]'));
      expect(panel.querySelector('a[href="/api/report"]')?.textContent).toBe("Download a redacted report");
      await press(control("Install this version", panel));
      await act(async () => {
        enter(panel.querySelector('input[name="current"]'), "old-fixture-password");
        enter(panel.querySelector('input[name="new"]'), "new-fixture-password");
        enter(panel.querySelector('input[name="confirm"]'), "new-fixture-password");
      });
      await press(control("Change password", panel));
      expect(writes).toEqual([
        { url: "/api/reach/paths" },
        { url: "/api/reach/pins" },
        { url: "/api/actions/disk" },
        { url: "/api/panel/update" },
        { url: "/api/password", payload: { current: "old-fixture-password", new: "new-fixture-password", confirm: "new-fixture-password" } },
      ]);
    });
  });
});
