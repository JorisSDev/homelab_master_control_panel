import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
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

describe("maintenance page", () => {
  it("opens on home from the logo and keeps findings off the sidebar", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} />);
    const brand = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
    expect(brand).toContain('aria-label="Home"');
    expect(brand).toContain('class="logo"');
    expect(brand).toContain("Master control panel");
    expect(html).not.toContain(">Home<");
    expect(html).not.toContain(">Findings<");
    expect(html).not.toContain(">Home</h2>");
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    for (const label of ["Containers", "Storage", "Update", "Scan", "Panel"]) {
      expect(nav).toContain(`>${label}<`);
    }
    expect(nav).not.toContain(">Home<");
    expect(nav).not.toContain(">Findings<");
    expect(html).toContain("CT 201");
    expect(html).toContain("media");
    expect(html).toContain('href="http://10.0.0.30:32400/web"');
    expect(html).toContain("nginx");
    expect(html).toContain("1 stopped");
    expect(html).not.toContain("VM 216");
    expect(html).toContain("host example finding");
    expect(html).toContain("On the host");
    expect(html).toContain("Scan Tue 02 Jan 04:00");
    expect(html).toContain("Update Sun 04 Jan 06:00");
    expect(html).toContain("Storage 20.0 GB free on /");
    expect(html).toContain("Panel dev");
    expect(html).not.toContain(">Open<");
    expect(html).not.toContain("What the host is doing");
    expect(html).not.toContain("Unfinished");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    expect(html).not.toContain(">Health<");
    expect(html).not.toContain("Run the scan");
    expect(html).not.toContain("restart playback");
    expect(html).not.toContain("apt-get install");
    const clear = renderToStaticMarkup(
      <App
        initial={{ ...fixture, findings: { ...fixture.findings, count: 0, items: [] } }}
        live={false}
      />,
    );
    expect(clear).toContain("Nothing needs attention.");
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
    const html = renderToStaticMarkup(<App initial={running} live={false} initialSection="scan" />);
    expect(html).toContain("Scan running");
    expect(html).toContain("Malware scan on guest 201");
    expect(html).toContain("5 min");
    expect(html).toContain("step-current");
    expect(html).toContain(">Now<");
    expect(html).not.toContain("Run the scan");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
  });

  it("keeps the update confirmation behind a second button", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} initialSection="update" />);
    expect(html.indexOf("Check for updates")).toBeLessThan(html.indexOf("Update all"));
    expect(html).toContain("Update all");
    expect(html).toContain("Check for updates");
    expect(html).toContain("Not checked.");
    expect(html).toContain("Next run");
    expect(html).not.toContain("Start the update");
    expect(html).not.toContain("restarts playback");
    expect(html).not.toContain("The last report was a dry run");
    expect(html).not.toContain("Asks what apt would upgrade");
    expect(html).not.toContain("Transcript");
    expect(html).toContain("Guest 201 · Packages");
    expect(html).toContain("=== homelab-update start ===");
    expect(html).toContain("Host packages");
    expect(html).toContain("Not checked");
    const guest = html.slice(html.indexOf("CT 201"), html.indexOf("VM 216"));
    const vm = html.slice(html.indexOf("VM 216"), html.indexOf("Host packages"));
    expect(guest).toContain(">Update<");
    expect(guest).toContain("media");
    expect(vm).not.toContain(">Update<");
    expect(vm).toContain("house");
    expect(html).not.toContain("apt-get install");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    const updating = renderToStaticMarkup(
      <App
        initial={{ ...fixture, guest_updates: { ...fixture.guest_updates, active: "201" } }}
        live={false}
        initialSection="update"
      />,
    );
    expect(updating).toContain("media is updating");
    expect(updating).not.toContain("Start the update");
  });

  it("names containers without an Open button", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} initialSection="services" />);
    expect(html).toContain(">Containers<");
    expect(html).not.toContain(">Health<");
    expect(html).toContain("CT 201");
    expect(html).toContain("VM 216");
    expect(html).toContain('href="http://10.0.0.30:32400/web"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("nextcloud:apache");
    expect(html).toContain("—");
    expect(html).not.toContain(">Open<");
    expect(html).not.toContain('class="open"');
    expect(html).toContain('aria-label="Filter"');
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    expect(html).not.toContain("apt-get install");
    const mixed: ViewState = {
      ...fixture,
      services: {
        ...fixture.services,
        rows: [
          fixture.services.rows[1],
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
          },
          fixture.services.rows[0],
        ],
      },
    };
    const ordered = renderToStaticMarkup(<App initial={mixed} live={false} initialSection="services" />);
    expect(ordered.indexOf("CT 201")).toBeLessThan(ordered.indexOf("VM 216"));
    expect(ordered.indexOf("VM 216")).toBeLessThan(ordered.indexOf("CT 330"));
  });

  it("shows package versions after a check", () => {
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
    const html = renderToStaticMarkup(<App initial={checked} live={false} initialSection="update" />);
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
    const empty = renderToStaticMarkup(<App initial={waiting} live={false} initialSection="update" />);
    expect(empty).toContain("Nothing is waiting.");
  });

  it("offers install only when a newer release exists", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} initialSection="panel" />);
    expect(html).toContain("Install");
    expect(html).toContain("Sign out");
    expect(html).toContain("v0.4.0");
    const current = {
      ...fixture,
      panel: { ...fixture.panel, update_available: false },
    };
    const same = renderToStaticMarkup(<App initial={current} live={false} initialSection="panel" />);
    expect(same).not.toContain(">Install<");
    expect(same).toContain("Sign out");
  });
});
