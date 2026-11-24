import { useEffect, useState } from "react";
import { Badge, Meter, Page } from "../components/Chrome";
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
          <button type="button" className="quiet-button" onClick={() => away.dismiss()}>
            Dismiss
          </button>
        </div>
      ) : null}
      <p className="section-label">Attention</p>
      {attention.length === 0 ? (
        <p>The house is clear.</p>
      ) : (
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
      )}
      <p className="section-label">Host</p>
      <div className="figures">
        <div className="figure">
          <span className="section-label">Load</span>
          <strong className="figure-value num">{figures?.load || state.health.load || "Unknown"}</strong>
          <span className="meta">Last minute</span>
        </div>
        <Memory assigned={figures?.memory_assigned || ""} total={figures?.memory_total || state.health.memory_total} used={state.health.memory_used} />
        <Space label="Root" free={figures?.root_free || state.health.disk_free} total={figures?.root_total || state.health.disk_total} />
        <Space label="Disk shelf" free={shelfFree(state)} total={shelfTotal(state)} />
      </div>
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
      <div className="figure">
        <Meter label={label} free={free} total={total} caption={`${free} free`} />
      </div>
    );
  }
  return (
    <div className="figure">
      <span>{label}</span>
      <strong className="num">{free ? `${free} free` : "Unknown"}</strong>
    </div>
  );
}

function Memory({ assigned, total, used }: { assigned: string; total: string; used: string }) {
  const assignedN = amount(assigned);
  const totalN = amount(total);
  if (assigned && total && assignedN !== null && totalN !== null && totalN > 0) {
    const over = assignedN > totalN;
    return (
      <div className="figure">
        <Meter
          label="Memory"
          free={assigned}
          total={total}
          percent={(assignedN / totalN) * 100}
          caption={`${assigned} assigned on a ${total} host${over ? ". Overcommitted" : ""}`}
        />
      </div>
    );
  }
  const value = assigned ? `${assigned} assigned` : used && total ? `${used} of ${total}` : "Unknown";
  return (
    <div className="figure">
      <span>Memory</span>
      <strong className="num">{value}</strong>
    </div>
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
