import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { ViewState } from "./types";

const fixture: ViewState = {
  refresh_seconds: 10,
  actions: { update_confirmation: "restart playback" },
  now: {
    idle: true,
    text: "Nothing is running. The next scan and the next update are in the schedule below.",
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
        steps: ["-- CT 201 apt --"],
        transcript: "=== homelab-update start ===",
        hidden_lines: 0,
      },
    ],
    scan: [
      {
        heading: "2026-01-02T04:05:00+00:00 · 35 min",
        ok: true,
        result: "clean",
        steps: ["-- 201 clamav --"],
        transcript: "scan clean",
        hidden_lines: 2,
      },
    ],
  },
  unfinished: {
    facts: [
      "Plex on CT 201 is 9.9.9. That is newer than 1.0.0.",
      "One TCP port stays the only intentional WAN forward.",
    ],
    guests: [
      {
        id: "201",
        name: "media",
        address: "10.0.0.30",
        kind: "apt",
        last_update: "seen in dry run",
        last_scan: "clean",
        href: "http://10.0.0.30:32400/web",
      },
    ],
  },
};

describe("maintenance page", () => {
  it("renders the four sections in order without controls", () => {
    const html = renderToStaticMarkup(<App initial={fixture} live={false} />);
    const now = html.indexOf(">Now<");
    const schedule = html.indexOf(">Schedule<");
    const history = html.indexOf(">History<");
    const unfinished = html.indexOf(">Unfinished<");
    expect(now).toBeGreaterThan(-1);
    expect(now).toBeLessThan(schedule);
    expect(schedule).toBeLessThan(history);
    expect(history).toBeLessThan(unfinished);
    expect(html).toContain("Host housekeeping");
    expect(html).toContain("Transcript");
    expect(html).toContain("can start the scan");
    expect(html).toContain("Run the scan");
    expect(html).toContain("Run the update");
    expect(html).toContain("restart playback");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
    const transcript = html.indexOf("Transcript");
    expect(transcript).toBeGreaterThan(-1);
    expect(transcript).toBeLessThan(html.indexOf("-- CT 201 apt --"));
  });

  it("marks the current step and disables both actions while a job runs", () => {
    const running: ViewState = {
      ...fixture,
      now: {
        idle: false,
        text: "",
        jobs: [{ label: "daily scan", since: "Thu 02 Jan 04:05", elapsed: "5 min" }],
        step: { step: "clamav", guest: "201" },
        timeline: [
          { text: "-- 201 leftovers --", current: false, guest: "", step: "", elapsed: "" },
          { text: "-- 201 clamav --", current: true, guest: "201", step: "clamav", elapsed: "5 min" },
        ],
        waiting: false,
        lock: "This job holds the maintenance lock, so the other job waits until it finishes.",
      },
    };
    const html = renderToStaticMarkup(<App initial={running} live={false} />);
    expect(html).toContain("step-current");
    expect(html).toContain("clamav on 201, 5 min elapsed.");
    expect(html).toContain("-- 201 leftovers --");
    expect(html).toContain("disabled");
    expect(html).not.toContain("api/push");
    expect(html).not.toContain("machineIdentifier");
  });
});
