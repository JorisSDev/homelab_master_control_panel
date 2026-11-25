import { ArrowDownToLine, ArrowRight, CalendarDays, Check, CircleAlert, CircleHelp, Radio, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Empty, Meter, Page, Panel, RouteLink } from "../components/Chrome";
import { PatchSummary, patchStatusOf } from "../components/PatchStatus";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { awayLines, capacityMb, digestOf } from "../lib";
import type { AttentionItem, ViewState } from "../types";

const SEEN = "homelab-panel-seen";
const snapshotTime = new Intl.DateTimeFormat("lt-LT", { dateStyle: "short", timeStyle: "short" });

const severityRank: Record<string, number> = { down: 0, attention: 1, unknown: 2 };

export function Overview({ state, go, stale }: {
  state: ViewState;
  go: (path: string) => void;
  stale: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const attention = [...attentionOf(state)].sort((a, b) => (severityRank[a.severity] ?? 2) - (severityRank[b.severity] ?? 2));
  const shown = expanded ? attention : attention.slice(0, 3);
  const away = useAway(state);
  const figures = state.figures;
  const shelf = shelfRow(state);
  const coming = comingJobs(state);
  const running = !state.scan.idle ? state.scan : !state.update.idle ? state.update : null;
  const runningHref = !state.scan.idle ? "/jobs/scan" : "/jobs/update";
  const offerRecovery = typeof state.uptime_seconds === "number" && state.uptime_seconds < 1800;
  const machines = state.services.rows;
  const up = machines.filter((row) => row.status === "Running").length;
  const stopped = machines.filter((row) => row.status === "Stopped").length;
  const unknown = machines.length - up - stopped;
  const gaps = attention.filter((item) => item.severity === "unknown").length;
  const issues = attention.length - gaps;
  let headline = "No issues reported";
  if (stale) headline = "Last known health";
  else if (issues) headline = `${issues} ${issues === 1 ? "issue needs" : "issues need"} attention`;
  else if (gaps) headline = "Health data incomplete";

  const HealthIcon = stale || gaps && !issues ? CircleHelp : issues ? CircleAlert : Check;
  const tone = stale ? "attention" : attention.some((item) => item.severity === "down") ? "down" : attention.length ? "attention" : "up";
  const observed = state.observed_at ? new Date(state.observed_at) : null;
  const monitors = state.reach?.monitors.rows ?? [];
  const monitorUp = monitors.filter((row) => row.status === "up").length;
  const monitorDown = monitors.filter((row) => row.status === "down").length;
  const monitorOther = monitors.length - monitorUp - monitorDown;

  return (
    <Page title="Overview" className="overview-page" action={(
      <Button variant="outline" asChild><a href="/api/report"><ArrowDownToLine aria-hidden="true" /><span>Report</span></a></Button>
    )}>
      <section className="surface-card health-panel" aria-labelledby="health-heading">
        <div className="health-summary">
          <div className="health-heading">
            <div className={`health-symbol tone-${tone}`}><HealthIcon aria-hidden="true" /></div>
            <div>
              <h2 id="health-heading">{headline}</h2>
              <p className="quiet">{machines.length ? `${up} running · ${stopped} stopped${unknown ? ` · ${unknown} unknown` : ""}` : "No machine readings"}{issues && gaps ? ` · ${gaps} ${gaps === 1 ? "reading unavailable" : "readings unavailable"}` : ""}</p>
            </div>
          </div>
          {observed && Number.isFinite(observed.getTime()) ? (
            <div className="snapshot-time">
              <span>Last snapshot</span>
              <time className="num" dateTime={state.observed_at}>{snapshotTime.format(observed)}</time>
            </div>
          ) : null}
        </div>
        {shown.length > 0 ? (
          <ul className="alert-list" id="overview-alerts">
            {shown.map((item, index) => (
              <li key={`${item.href}-${item.text}-${index}`}>
                <RouteLink href={item.href} go={go}>
                  <Badge value={item.severity === "down" ? "Issue" : item.severity === "unknown" ? "Unknown" : "Review"} />
                  <span>{item.text}</span>
                  <ArrowRight aria-hidden="true" />
                </RouteLink>
              </li>
            ))}
          </ul>
        ) : null}
        {attention.length > 3 ? (
          <div className="health-footer"><Button type="button" variant="ghost" aria-expanded={expanded} aria-controls="overview-alerts" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show fewer" : `Show all ${attention.length} findings`}
          </Button></div>
        ) : null}
      </section>
      {away.lines.length > 0 ? (
        <div className="surface-card changes-panel">
          <div><h2 className="section-title">Since your last visit</h2><ul>{away.lines.map((line) => <li key={line}>{line}</li>)}</ul></div>
          <Button type="button" variant="ghost" onClick={away.dismiss}>Dismiss</Button>
        </div>
      ) : null}
      {offerRecovery ? (
        <RouteLink href="/recovery" go={go} className="surface-card recovery-link">
          <CircleAlert aria-hidden="true" /><span>Open the recovery checklist</span><ArrowRight aria-hidden="true" />
        </RouteLink>
      ) : null}
      <Panel title="Patch status" action={<RouteLink className="section-link" href="/jobs/update" go={go}>View patch details <ArrowRight aria-hidden="true" /></RouteLink>}>
        <PatchSummary patch={patchStatusOf(state)} />
        <p className="meta">Package counts are from recorded checks against local APT lists.</p>
      </Panel>
      <div className="overview-columns">
        <Panel title="Host resources" className="resources-panel">
          <div className="resource-grid">
            <Processor load={figures?.load || state.health.load || ""} cores={figures?.cores || state.health.cores || 0} usage={state.health.cpu_usage} />
            <Memory used={figures?.memory_used || state.health.memory_used} total={figures?.memory_total || state.health.memory_total} assigned={figures?.memory_assigned || ""} />
            <Space label="Internal" used={state.health.disk_used} free={figures?.root_free || state.health.disk_free} total={figures?.root_total || state.health.disk_total} />
            <Space label="External" used={shelf?.used} free={figures?.das_free || shelf?.free || ""} total={figures?.das_total || shelf?.total || ""} unmounted={state.das?.match === "Not mounted"} />
          </div>
        </Panel>
        <Panel title="Coming up" action={<RouteLink className="section-link" href="/jobs" go={go}>View jobs <ArrowRight aria-hidden="true" /></RouteLink>}>
          {running ? (
            <div className="running-job">
              <Badge value={running.status} />
              <RouteLink href={runningHref} go={go}>{running.detail || "Open job"}</RouteLink>
              {running.elapsed ? <span className="meta num">{running.elapsed}</span> : null}
            </div>
          ) : null}
          {coming.length ? (
            <ol className="upcoming-list">
              {coming.map((item) => (
                <li key={item.name}>
                  <RouteLink href="/jobs" go={go}>
                    <CalendarDays aria-hidden="true" />
                    <span>{item.name}<span className="meta num">{item.next}</span></span>
                  </RouteLink>
                </li>
              ))}
            </ol>
          ) : <Empty>No scheduled jobs were reported.</Empty>}
        </Panel>
      </div>
      <div className="overview-columns">
        <Panel title="Machines" action={<RouteLink className="section-link" href="/guests" go={go}>View machines <ArrowRight aria-hidden="true" /></RouteLink>}>
          {machines.length ? (
            <ul className="machine-overview">
              {machines.map((row) => (
                <li key={row.id}>
                  <RouteLink href={`/guests/${row.id}`} go={go} aria-label={`${row.name}, ${row.status}`}>
                    <Server aria-hidden="true" /><span>{row.name}</span><Badge value={row.status} />
                  </RouteLink>
                </li>
              ))}
            </ul>
          ) : <Empty>No machines were read.</Empty>}
        </Panel>
        <Panel title="Reach" action={<RouteLink className="section-link" href="/reach" go={go}>View monitors <ArrowRight aria-hidden="true" /></RouteLink>}>
          {monitors.length ? (
            <div className="reach-overview">
              <Radio aria-hidden="true" /><div><strong>{monitorUp} up, {monitorDown} down</strong>
              {monitorOther ? <span className="meta">{monitorOther} pending, in maintenance or unknown</span> : null}</div>
            </div>
          ) : <Empty>{state.reach?.monitors.summary || "No monitor readings are available."}</Empty>}
        </Panel>
      </div>
    </Page>
  );
}

function Processor({ load, cores, usage }: { load: string; cores: number; usage?: number | null }) {
  const value = Number(load);
  const hasLoad = load.trim() !== "" && Number.isFinite(value) && value >= 0;
  const share = hasLoad && cores > 0 ? Math.round((value / cores) * 100) : null;
  const hasUsage = typeof usage === "number" && Number.isFinite(usage) && usage >= 0 && usage <= 100;
  return (
    <div className="metric">
      <span className="section-label">{hasUsage ? "CPU usage" : share === null ? "Processor" : "Load per core"}</span>
      <strong className="figure-value num">{hasUsage ? `${Math.round(usage)}%` : share === null ? (hasLoad ? load : "Unknown") : `${share}%`}</strong>
      <span className="meta">{!hasLoad ? "Load unavailable" : cores > 0 ? `Load ${load} on ${cores} ${cores === 1 ? "core" : "cores"}` : "1-minute load average"}</span>
      {hasUsage ? <Progress value={usage} label="CPU usage" /> : null}
    </div>
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

function shelfRow(state: ViewState) {
  const label = state.figures?.das_label;
  return state.storage.rows.find((row) => (label ? row.label === label : row.label !== "/" && (row.used || row.free) && row.total));
}

function Space({ label, used, free, total, unmounted }: { label: string; used?: string; free: string; total: string; unmounted?: boolean }) {
  if (!unmounted) {
    return (
      <div className="metric">
        <Meter label={label} used={used} free={free} total={total} />
      </div>
    );
  }
  return (
    <div className="metric">
      <span className="section-label">{label}</span>
      <strong className="figure-value num">Not mounted</strong>
    </div>
  );
}

function Memory({ used, total, assigned }: { used: string; total: string; assigned: string }) {
  const usedN = capacityMb(used);
  const totalN = capacityMb(total);
  const assignedN = capacityMb(assigned);
  if (used && total && usedN !== null && totalN !== null && totalN > 0) {
    const over = assignedN !== null && assignedN > totalN;
    return (
      <div className="metric">
        <Meter label="Memory" used={used} total={total} caption="in use" />
        {assigned ? <span className="meta">{assigned} assigned{over ? " · Overcommitted" : ""}</span> : null}
      </div>
    );
  }
  return (
    <div className="metric">
      <span className="section-label">Memory</span>
      <strong className="figure-value num">{used && total ? `${used} of ${total}` : "Unknown"}</strong>
    </div>
  );
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
