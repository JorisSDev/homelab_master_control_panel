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
  home: {
    cards: [
      { id: "update", title: "Update", status: "Idle", detail: "Last report: dry run." },
      { id: "scan", title: "Scan", status: "Idle", detail: "Last report: clean." },
      { id: "health", title: "Health", status: "All right", detail: "Load 0.4" },
      { id: "panel", title: "Panel", status: "dev", detail: "This copy of the panel." },
    ],
  },
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
};

describe("maintenance page", () => {
  it("opens on home and keeps the four jobs in the sidebar", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} />);
    expect(html).toContain("Master control panel");
    expect(html).not.toContain("What the host is doing");
    expect(html).not.toContain("Unfinished");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    for (const label of ["Home", "Update", "Scan", "Health", "Panel"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("Last report: clean.");
    expect(html).not.toContain("Run the scan");
    expect(html).not.toContain("restart playback");
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
    expect(html).toContain("It restarts playback.");
    expect(html).toContain("7 Debian security packages");
    expect(html).toContain("Run the update");
    expect(html).not.toContain("Start the update");
    const transcript = html.indexOf("Transcript");
    expect(transcript).toBeGreaterThan(-1);
    expect(transcript).toBeLessThan(html.indexOf("Guest 201 · Packages"));
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
