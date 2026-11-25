import { useEffect, useState } from "react";
import { Badge, Meter, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { awayLines, digestOf } from "../lib";
import type { AttentionItem, ViewState } from "../types";

const SEEN = "homelab-panel-seen";

export function Overview({
  state,
  go,
}: {
  state: ViewState;
  go: (path: string) => void;
}) {
  const attention = attentionOf(state);
  const away = useAway(state);
  const figures = state.figures;
  const coming = comingJobs(state);
  const running = !state.scan.idle ? state.scan : !state.update.idle ? state.update : null;
  const runningHref = !state.scan.idle ? "/jobs/scan" : "/jobs/update";
  const offerRecovery = typeof state.uptime_seconds === "number" && state.uptime_seconds < 1800;
  const machines = state.services.rows;
  const up = machines.filter((row) => row.status === "Running").length;
  const stopped = machines.filter((row) => row.status === "Stopped").length;
  const counts = stopped > 0 ? `${up} running, ${stopped} stopped` : `${up} running`;
  const house = attention.length === 0 ? `${counts}. The house is clear.` : `${counts}. ${attention.length} ${attention.length === 1 ? "needs" : "need"} you.`;
  const monitors = state.reach?.monitors.rows ?? [];
  const monitorUp = monitors.filter((row) => row.status === "up").length;
  const monitorDown = monitors.filter((row) => row.status === "down").length;

  return (
    <Page
      title="Overview"
      context="What needs you, and what changed."
      action={
        <a className="text-link" href="/api/report">
          Report
        </a>
      }
    >
      {away.lines.length > 0 ? (
        <div className="band">
          <div>
            {away.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => away.dismiss()}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <p className="house-line">{house}</p>
      {attention.length > 0 ? (
        <ul className="attention">
          {attention.map((item) => (
            <li key={`${item.href}-${item.text}`}>
              <a
                href={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  go(item.href);
                }}
              >
                <Badge value={item.severity} />
                <span>{item.text}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="figures">
        <Processor load={figures?.load || state.health.load || ""} cores={figures?.cores || state.health.cores || 0} />
        <Memory
          used={figures?.memory_used || state.health.memory_used}
          total={figures?.memory_total || state.health.memory_total}
          assigned={figures?.memory_assigned || ""}
        />
        <Space label="Internal" free={figures?.root_free || state.health.disk_free} total={figures?.root_total || state.health.disk_total} />
        <Space label="External" free={shelfFree(state)} total={shelfTotal(state)} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <Card className="figure">
          <p className="section-label">Machines</p>
          {machines.length === 0 ? <p className="quiet">No machines were read.</p> : null}
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {machines.map((row) => (
              <a
                key={row.id}
                className="inline-flex min-w-0 items-center gap-2 border border-[var(--line)] px-2 py-2"
                href={`/guests/${row.id}`}
                aria-label={`${row.name}, ${row.status}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(`/guests/${row.id}`);
                }}
              >
                <span className={`status tone-${markTone(row.status)}`} aria-hidden="true">
                  <span className="status-mark" />
                </span>
                <span className="truncate">{row.name}</span>
              </a>
            ))}
          </div>
        </Card>
        <div className="grid gap-4">
          {monitors.length > 0 ? (
            <Card className="figure">
              <p className="section-label">Reach</p>
              <a
                className="text-link"
                href="/reach"
                onClick={(event) => {
                  event.preventDefault();
                  go("/reach");
                }}
              >
                {monitorUp} up, {monitorDown} down
              </a>
            </Card>
          ) : null}
          <div className="strip coming">
            <p className="section-label">Coming up</p>
            {coming.length === 0 ? (
              <p className="quiet">No house jobs were read.</p>
            ) : (
              <ol className="sequence">
                {coming.map((item) => (
                  <li key={item.name}>
                    <a
                      href="/jobs"
                      onClick={(event) => {
                        event.preventDefault();
                        go("/jobs");
                      }}
                    >
                      <span>{item.name}</span>
                      <span className="num">{item.next}</span>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
      {running ? (
        <p>
          <a
            href={runningHref}
            onClick={(event) => {
              event.preventDefault();
              go(runningHref);
            }}
          >
            {running.status}
          </a>
          {running.detail ? ` · ${running.detail}` : ""}
          {running.elapsed ? ` · ${running.elapsed}` : ""}
        </p>
      ) : null}
      {offerRecovery ? (
        <p>
          <a
            href="/recovery"
            onClick={(event) => {
              event.preventDefault();
              go("/recovery");
            }}
          >
            Open the recovery checklist
          </a>
        </p>
      ) : null}
    </Page>
  );
}

function markTone(status: string) {
  if (status === "Stopped") {
    return "down";
  }
  if (status === "Running") {
    return "up";
  }
  return "attention";
}

function Processor({ load, cores }: { load: string; cores: number }) {
  const value = Number(load);
  const share = Number.isFinite(value) && cores > 0 ? Math.round((value / cores) * 100) : null;
  return (
    <Card className="figure">
      <span className="section-label">Processor</span>
      <strong className="figure-value num">{share === null ? load || "Unknown" : `${share}%`}</strong>
      <span className="meta">{share === null ? "1-minute load average" : `Load ${load} on ${cores} ${cores === 1 ? "core" : "cores"}`}</span>
      <Progress value={share === null ? 0 : Math.min(100, share)} low={share !== null && share >= 100} />
    </Card>
  );
}

const HOUSE = [
  { rule: "Scan", name: "Scan", units: ["homelab-scan.timer"], source: "scan" },
  { rule: "Update", name: "Sunday update", units: ["homelab-update.timer"], source: "update" },
  { rule: "Proxmox", name: "Proxmox package refresh", units: ["pve-daily-update.timer"], source: "" },
] as const;

function comingJobs(state: ViewState) {
  const rules = new Set((state.calendar?.rules || []).map((rule) => rule.label));
  const week = state.week || [];
  const rows: { name: string; next: string }[] = [];
  for (const house of HOUSE) {
    if (!rules.has(house.rule)) {
      continue;
    }
    const units: readonly string[] = house.units;
    const scheduled = week.find((item) => units.includes(item.unit) && knownTime(item.next));
    const fallback = house.source === "scan" ? state.scan.next : house.source === "update" ? state.update.next : "";
    const next = scheduled?.next || (knownTime(fallback) ? fallback : "");
    if (!next) {
      continue;
    }
    rows.push({ name: house.name, next });
  }
  return rows;
}

function knownTime(value: string | undefined) {
  const text = (value || "").trim();
  return Boolean(text) && text !== "not scheduled";
}

function shelfFree(state: ViewState) {
  if (state.figures?.das_free) {
    return state.figures.das_free;
  }
  const row = shelfRow(state);
  return row?.free || "";
}

function shelfTotal(state: ViewState) {
  if (state.figures?.das_total) {
    return state.figures.das_total;
  }
  const row = shelfRow(state);
  return row?.total || "";
}

function shelfRow(state: ViewState) {
  const label = state.figures?.das_label;
  return state.storage.rows.find((row) => (label ? row.label === label : row.label !== "/" && row.free && row.total));
}

function Space({ label, free, total }: { label: string; free: string; total: string }) {
  if (free && total) {
    return (
      <Card className="figure">
        <Meter label={label} free={free} total={total} caption="free" />
      </Card>
    );
  }
  return (
    <Card className="figure">
      <span className="section-label">{label}</span>
      <strong className="figure-value num">{free ? `${free} free` : "Not mounted"}</strong>
    </Card>
  );
}

function Memory({ used, total, assigned }: { used: string; total: string; assigned: string }) {
  const usedN = amount(used);
  const totalN = amount(total);
  const assignedN = amount(assigned);
  if (used && total && usedN !== null && totalN !== null && totalN > 0) {
    const over = assignedN !== null && assignedN > totalN;
    return (
      <Card className="figure">
        <Meter label="Memory" free={used} total={total} percent={(usedN / totalN) * 100} caption="in use" />
        {assigned ? <span className="meta">{assigned} assigned{over ? " · Overcommitted" : ""}</span> : null}
      </Card>
    );
  }
  return (
    <Card className="figure">
      <span className="section-label">Memory</span>
      <strong className="figure-value num">{used && total ? `${used} of ${total}` : "Unknown"}</strong>
    </Card>
  );
}

function amount(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*(TB|GB|MB)?$/i);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number)) {
    return null;
  }
  const unit = (match[2] || "GB").toUpperCase();
  if (unit === "TB") {
    return number * 1024;
  }
  if (unit === "MB") {
    return number / 1024;
  }
  return number;
}

function attentionOf(state: ViewState): AttentionItem[] {
  if (state.attention) {
    return state.attention;
  }
  return state.findings.items.map((item) => ({
    severity: "down",
    text: item.result,
    href: item.job === "update" ? "/jobs/update" : "/jobs/scan",
  }));
}

function useAway(state: ViewState) {
  const encoded = JSON.stringify(digestOf(state));
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const raw = window.localStorage.getItem(SEEN);
    if (!raw) {
      return;
    }
    try {
      setLines(awayLines(JSON.parse(raw), JSON.parse(encoded)));
    } catch {
      setLines([]);
    }
  }, [encoded]);
  return {
    lines,
    dismiss() {
      window.localStorage.setItem(SEEN, encoded);
      setLines([]);
    },
  };
}
