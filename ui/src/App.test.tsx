import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { ViewState } from "./types";

const fixture: ViewState = {
  refresh_seconds: 10,
  now: {
    idle: true,
    status: "Idle",
    detail: "Nothing is running. The next scan and the next update are in the schedule.",
    text: "Nothing is running. The next scan and the next update are in the schedule.",
    jobs: [],
    step: null,
    timeline: [],
    waiting: false,
    lock: "",
  },
  schedule: {
    featured: [
      {
        unit: "homelab-scan.timer",
        next: "Tue 02 Jan 04:00",
        last: "no run yet",
        note: "Daily leftover and ClamAV scan. It does not restart apps.",
      },
    ],
    housekeeping: [{ unit: "man-db.timer", next: "Wed 03 Jan 00:00", last: "Mon 01 Jan 00:00" }],
  },
  history: {
    update: [
      {
        heading: "2026-01-02T03:04:05+00:00 · dry run · under a minute",
        ok: true,
        result: "dry run",
        steps: ["Guest 201 · Packages"],
        transcript: "=== homelab-update start ===",
        hidden_lines: 0,
      },
    ],
    scan: [
      {
        heading: "2026-01-02T04:05:00+00:00 · 35 min",
        ok: true,
        result: "clean",
        steps: ["Guest 201 · Malware scan"],
        transcript: "scan clean",
        hidden_lines: 2,
      },
    ],
  },
};

describe("maintenance page", () => {
  it("renders the panel without the unfinished section", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} />);
    const now = html.indexOf(">Now<");
    const schedule = html.indexOf(">Schedule<");
    const history = html.indexOf(">History<");
    expect(html).toContain("Master control panel");
    expect(now).toBeGreaterThan(-1);
    expect(now).toBeLessThan(schedule);
    expect(schedule).toBeLessThan(history);
    expect(html).not.toContain("Unfinished");
    expect(html).toContain("Host housekeeping");
    expect(html).toContain("Transcript");
    expect(html).toContain("Run the scan");
    expect(html).toContain("Run the update");
    expect(html).not.toContain("restart playback");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    const transcript = html.indexOf("Transcript");
    expect(transcript).toBeGreaterThan(-1);
    expect(transcript).toBeLessThan(html.indexOf("Guest 201 · Packages"));
  });

  it("shows the running scan in plain language and hides the start buttons", () => {
    const running: ViewState = {
      ...fixture,
      now: {
        idle: false,
        status: "Scan running",
        detail: "Malware scan on guest 201",
        text: "",
        jobs: [{ label: "daily scan", since: "Thu 02 Jan 04:05", started: "04:05", elapsed: "5 min" }],
        step: { step: "clamav", guest: "201" },
        timeline: [
          { text: "Guest 201 · Leftover files", current: false, guest: "", step: "", elapsed: "" },
          { text: "Guest 201 · Malware scan", current: true, guest: "201", step: "clamav", elapsed: "5 min" },
        ],
        waiting: false,
        lock: "The scan is using the maintenance lock. The update waits until it finishes.",
      },
    };
    const html = renderToStaticMarkup(<App initial={running} live={false} />);
    expect(html).toContain("Scan running");
    expect(html).toContain("Malware scan on guest 201");
    expect(html).toContain("5 min");
    expect(html).toContain("step-current");
    expect(html).toContain(">Now<");
    expect(html).not.toContain("Run the scan");
    expect(html).not.toContain("restart playback");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
  });
});
