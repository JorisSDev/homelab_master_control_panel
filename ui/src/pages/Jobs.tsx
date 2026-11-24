import { useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { postJson } from "../lib";
import type { CalendarRule, ViewState } from "../types";

export function Jobs({
  state,
  path,
  onState,
}: {
  state: ViewState;
  path: string;
  onState: (next: ViewState) => void;
}) {
  const scan = path === "/jobs/scan" || path === "/jobs";
  const update = path === "/jobs/update" || path === "/jobs";
  return (
    <Page title="Jobs" context="Scheduled work, and the meaning of the last result.">
      {path === "/jobs" ? <Month state={state} /> : null}
      {scan ? <ScanDossier state={state} /> : null}
      {update ? <UpdateDossier state={state} onState={onState} /> : null}
    </Page>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Month({ state }: { state: ViewState }) {
  const rules = state.calendar?.rules || [];
  const standing = state.calendar?.standing || [];
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  if (rules.length === 0) {
    return (
      <>
        <Empty>No house jobs were read.</Empty>
        {standing.map((line) => (
          <p key={line} className="standing">
            {line}
          </p>
        ))}
      </>
    );
  }
  const cells = monthCells(cursor.year, cursor.month, rules);
  const legend = dailyLegend(rules);
  return (
    <div className="calendar">
      <div className="calendar-nav">
        <button type="button" className="quiet-button" onClick={() => setCursor((current) => shiftMonth(current, -1))}>
          Previous month
        </button>
        <p className="calendar-title">
          {MONTHS[cursor.month]} {cursor.year}
        </p>
        <button type="button" className="quiet-button" onClick={() => setCursor((current) => shiftMonth(current, 1))}>
          Next month
        </button>
      </div>
      {legend ? <p className="calendar-legend">{legend}</p> : null}
      <div className="calendar-grid" role="grid" aria-label={`${MONTHS[cursor.month]} ${cursor.year}`}>
        {WEEKDAYS.map((name) => (
          <div key={name} className="calendar-dow" role="columnheader">
            {name}
          </div>
        ))}
        {cells.map((cell) => (
          <div
            key={cell.key}
            role="gridcell"
            className={["day", cell.outside ? "outside" : "", cell.today ? "is-today" : ""].filter(Boolean).join(" ")}
            aria-current={cell.today ? "date" : undefined}
          >
            <span className="num">{cell.day}</span>
            {cell.jobs.map((job) => (
              <span key={job} className="day-job">
                {job}
              </span>
            ))}
          </div>
        ))}
      </div>
      {standing.map((line) => (
        <p key={line} className="standing">
          {line}
        </p>
      ))}
    </div>
  );
}

function shiftMonth(current: { year: number; month: number }, delta: number) {
  const next = new Date(current.year, current.month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function monthCells(year: number, month: number, rules: CalendarRule[]) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const last = new Date(year, month + 1, 0);
  const trail = 6 - ((last.getDay() + 6) % 7);
  const total = lead + last.getDate() + trail;
  const today = new Date();
  const cells: { key: string; day: number; outside: boolean; today: boolean; jobs: string[] }[] = [];
  for (let index = 0; index < total; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    cells.push({
      key: dateKey(date),
      day: date.getDate(),
      outside: date.getMonth() !== month,
      today: date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate(),
      jobs: jobsOn(date, rules),
    });
  }
  return cells;
}

function dailyLegend(rules: CalendarRule[]) {
  const daily = rules.filter((rule) => !rule.weekdays);
  if (daily.length === 0) {
    return "";
  }
  return `Every day · ${daily.map((rule) => `${rule.label} ${when(rule)}`).join(" · ")}`;
}

function jobsOn(date: Date, rules: CalendarRule[]) {
  const weekday = (date.getDay() + 6) % 7;
  return rules
    .filter((rule) => Array.isArray(rule.weekdays) && rule.weekdays.includes(weekday))
    .map((rule) => ({ time: rule.time, label: rule.label, until: rule.until }))
    .sort((left, right) => left.time.localeCompare(right.time) || left.label.localeCompare(right.label))
    .map((rule) => `${rule.label} ${when(rule)}`);
}

function when(rule: { time: string; until?: string }) {
  return rule.until ? `${rule.time}–${rule.until}` : rule.time;
}

function dateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function guestName(state: ViewState, id: string) {
  return state.services.rows.find((row) => row.id === id)?.name || id;
}

function HostPackages({ state }: { state: ViewState }) {
  const packages = state.packages;
  if (!packages.checked) {
    return (
      <p>
        Host packages <span>Not checked.</span>
      </p>
    );
  }
  if (!packages.total) {
    return <p>Nothing is waiting.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Host packages</th>
          <th>Current</th>
          <th>Candidate</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {packages.upgrades.map((row) => (
          <tr key={row.name} className={row.security ? "row-security" : "row-candidate"}>
            <td>{row.name}</td>
            <td className="num">{row.current}</td>
            <td className="num">{row.candidate}</td>
            <td>{row.security ? "Security" : "Other"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScanDossier({ state }: { state: ViewState }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const meaning = state.scan_meaning;
  const plex = state.plex;

  async function run() {
    setBusy(true);
    setMessage("");
    const result = await postJson("/api/actions/scan");
    setBusy(false);
    setMessage(result.ok ? "Starting the scan." : String(result.data.error || "The scan did not start."));
  }

  return (
    <article className="dossier">
      <header className="page-head">
        <div>
          <h2>Scan</h2>
          <p className="quiet">{state.scan.purpose}</p>
        </div>
        <div className="page-action">
          <Badge value={state.scan.status} />
          {state.scan.idle ? (
            <button type="button" disabled={busy} onClick={() => void run()}>
              Run the scan
            </button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <p>
        {state.scan.detail}
        {state.scan.elapsed ? ` · ${state.scan.elapsed}` : ""}
      </p>
      {state.scan.timeline.length > 0 ? (
        <ol className="timeline">
          {state.scan.timeline.map((step) => (
            <li key={step.text} className={step.current ? "step-current" : ""}>
              {step.current ? <span>Now</span> : null}
              {step.text}
            </li>
          ))}
        </ol>
      ) : null}
      {meaning && meaning.coverage.length > 0 ? (
        <ul>
          {meaning.coverage.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {meaning?.signature ? <p>{meaning.signature}</p> : null}
      {plex ? (
        <p>
          Plex {plex.version || "version unknown"}
          {plex.claimed === "1" ? ", claimed" : plex.claimed ? ", not claimed" : ""}. Render device {plex.render}.
        </p>
      ) : null}
      {(meaning?.streaks || []).map((streak) => (
        <p key={streak.text}>
          {streak.text} · {streak.count} times
        </p>
      ))}
    </article>
  );
}

function UpdateDossier({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [dry, setDry] = useState(false);
  const rows = state.guest_updates.rows;

  async function check() {
    setBusy("check");
    setMessage("");
    const host = await postJson("/api/packages/check");
    const guests = await postJson("/api/guests/check");
    setBusy("");
    if (!host.ok || !guests.ok) {
      setMessage(String(guests.data.error || host.data.error || "The check did not finish."));
      return;
    }
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
    setMessage("Checked for updates.");
  }

  async function start(kind: "update" | "dry") {
    setBusy(kind);
    setMessage("");
    const result = await postJson("/api/actions/update", kind === "dry" ? { confirm: true, dry: true } : { confirm: true });
    setBusy("");
    setConfirm(false);
    setDry(false);
    setMessage(result.ok ? "Starting the update." : String(result.data.error || "The update did not start."));
  }

  return (
    <article className="dossier">
      <header className="page-head">
        <div>
          <h2>Sunday update</h2>
          <p className="quiet">Next run {state.update.next}</p>
        </div>
        <div className="page-action">
          <Badge value={state.update.status} />
          <button type="button" className="quiet-button" disabled={busy !== ""} onClick={() => void check()}>
            Check for updates
          </button>
          <button type="button" className="quiet-button" disabled={busy !== ""} onClick={() => setDry(true)}>
            Dry run
          </button>
          {state.update.idle ? (
            <button type="button" disabled={busy !== ""} onClick={() => setConfirm(true)}>
              Update all
            </button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") || message.startsWith("Checked") ? "ok" : "bad"}>{message}</p> : null}
      <p>
        {state.update.detail}
        {state.update.elapsed ? ` · ${state.update.elapsed}` : ""}
      </p>
      {state.guest_updates.active ? <p>{guestName(state, state.guest_updates.active)} is updating</p> : null}
      {(state.update.history[0]?.steps || []).map((step) => (
        <p key={step}>{step}</p>
      ))}
      <HostPackages state={state} />
      {rows.length === 0 ? <Empty>No guest update check has been saved.</Empty> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Guest</th>
              <th>Packages</th>
              <th>Security</th>
              <th>Compose</th>
              <th>Reboot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td className="num">{row.packages}</td>
                <td className="num">{row.security}</td>
                <td>{row.compose.join(", ") || (row.floating ? "floating tag" : "—")}</td>
                <td>{row.reboot ? "wanted" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {confirm ? (
        <Confirm
          title="Start the update"
          confirmLabel="Start the update"
          busy={busy !== ""}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void start("update")}
        >
          <p>This restarts playback, recreates Compose services, and has no vzdump rollback.</p>
        </Confirm>
      ) : null}
      {dry ? (
        <Confirm
          title="Start the dry run"
          confirmLabel="Start the dry run"
          busy={busy !== ""}
          onCancel={() => setDry(false)}
          onConfirm={() => void start("dry")}
        >
          <p>This previews the Sunday update and does not install packages.</p>
        </Confirm>
      ) : null}
    </article>
  );
}
