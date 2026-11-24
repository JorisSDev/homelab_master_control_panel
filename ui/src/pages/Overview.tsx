import { useEffect, useState } from "react";
import { Badge, Empty, Page } from "../components/Chrome";
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
  const soon = (state.upcoming || []).filter((item) => item.soon);
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
      <div className="figures">
        <Figure label="Load" value={figures?.load || state.health.load || "Unknown"} />
        <Figure
          label="Memory"
          value={
            figures?.memory_assigned
              ? figures.memory_total || state.health.memory_total
                ? `${figures.memory_assigned} assigned of ${figures.memory_total || state.health.memory_total}`
                : `${figures.memory_assigned} assigned`
              : state.health.memory_used && state.health.memory_total
                ? `${state.health.memory_used} of ${state.health.memory_total}`
                : "Unknown"
          }
        />
        <Figure label="Root" value={state.health.disk_free ? `${figures?.root_free || state.health.disk_free} free` : "Unknown"} />
        <Figure label="Disk shelf" value={figures?.das_free ? `${figures.das_free} free` : "Unknown"} />
      </div>
      <div className="strip">
        <p>
          Next scan {state.scan.next}. Next Sunday update {state.update.next}.
        </p>
        {soon.length > 0 ? (
          <ol className="sequence">
            {soon.map((item) => (
              <li key={item.unit}>
                <a
                  href="/jobs"
                  onClick={(event) => {
                    event.preventDefault();
                    go("/jobs");
                  }}
                >
                  {item.label}
                </a>
                <span className="num">{item.next}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="quiet">Nothing else is scheduled in the next 48 hours.</p>
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
      <Chronology state={state} go={go} />
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="figure">
      <span>{label}</span>
      <strong className="num">{value}</strong>
    </div>
  );
}

function Chronology({ state, go }: { state: ViewState; go: (path: string) => void }) {
  const items = state.chronology || [];
  if (items.length === 0) {
    return <Empty>No recent events.</Empty>;
  }
  return (
    <ol className="chronology">
      {items.map((item) => (
        <li key={`${item.href}-${item.text}`}>
          <a
            href={item.href}
            onClick={(event) => {
              event.preventDefault();
              go(item.href);
            }}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
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
