import { useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
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
      {path === "/jobs" ? <Month state={state} onState={onState} /> : null}
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

function Month({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
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
  const cells = monthCells(cursor.year, cursor.month, rules, state.schedule);
  const legend = dailyLegend(rules);
  return (
    <div className="calendar">
      <div className="calendar-nav">
        <Button type="button" variant="outline" onClick={() => setCursor((current) => shiftMonth(current, -1))}>
          Previous month
        </Button>
        <p className="calendar-title">
          {MONTHS[cursor.month]} {cursor.year}
        </p>
        <Button type="button" variant="outline" onClick={() => setCursor((current) => shiftMonth(current, 1))}>
          Next month
        </Button>
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
      <ScheduleForm state={state} onState={onState} />
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

function monthCells(year: number, month: number, rules: CalendarRule[], schedule?: ViewState["schedule"]) {
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
      jobs: markedJobs(dateKey(date), jobsOn(date, rules), schedule),
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

function markedJobs(key: string, jobs: string[], schedule?: ViewState["schedule"]) {
  const next = jobs.map((job) => (schedule?.skip === key && job.startsWith("Update") ? "Skipped" : job));
  if (schedule?.once === key && schedule.once_time) {
    next.push(`Update ${schedule.once_time}`);
  }
  return next;
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

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ScheduleForm({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const weekly = state.schedule?.weekly;
  const [weekday, setWeekday] = useState(weekly?.weekday ?? 6);
  const [time, setTime] = useState(weekly?.time || "06:00");
  const [date, setDate] = useState("");
  const [onceTime, setOnceTime] = useState("06:00");
  const [pending, setPending] = useState<"skip" | "move" | "once" | "">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    setMessage("");
    const body =
      pending === "skip"
        ? { confirm: true, action: "skip", weekday: 6 }
        : pending === "move"
          ? { confirm: true, action: "move", weekday, time }
          : { confirm: true, action: "once", date, time: onceTime };
    const result = await postJson("/api/jobs/update/schedule", body);
    setBusy(false);
    setPending("");
    if (!result.ok) {
      setMessage(String(result.data.error || "The schedule was not changed."));
      return;
    }
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
    setMessage(pending === "once" ? "The extra run was scheduled." : "The Sunday update was rescheduled.");
  }

  return (
    <div className="schedule">
      <p className="section-label">Sunday update</p>
      {message ? <p className={message.endsWith(".") && !message.includes("not") ? "ok" : "bad"}>{message}</p> : null}
      <div className="row-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => setPending("skip")}>
          Skip next Sunday
        </Button>
      </div>
      <div className="schedule-row">
        <label>
          Weekly day
          <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
            {WEEKDAY_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weekly time
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setPending("move")}>
          Move weekly time
        </Button>
      </div>
      <div className="schedule-row">
        <label>
          Extra date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Extra time
          <input type="time" value={onceTime} onChange={(event) => setOnceTime(event.target.value)} />
        </label>
        <Button type="button" variant="outline" disabled={busy || !date} onClick={() => setPending("once")}>
          Schedule one run
        </Button>
      </div>
      {pending === "skip" ? (
        <Confirm title="Skip the next Sunday" confirmLabel="Skip next Sunday" busy={busy} onCancel={() => setPending("")} onConfirm={() => void apply()}>
          <p>The coming Sunday update will not run. The week after returns to the normal time.</p>
        </Confirm>
      ) : null}
      {pending === "move" ? (
        <Confirm title="Move the weekly update" confirmLabel="Move weekly time" busy={busy} onCancel={() => setPending("")} onConfirm={() => void apply()}>
          <p>
            This changes the weekly update to {WEEKDAY_NAMES[weekday]} at {time}. Other jobs stay where they are.
          </p>
        </Confirm>
      ) : null}
      {pending === "once" ? (
        <Confirm title="Schedule one update" confirmLabel="Schedule one run" busy={busy} onCancel={() => setPending("")} onConfirm={() => void apply()}>
          <p>
            This starts the update on {date} at {onceTime}. It restarts playback, recreates Compose services, and has no vzdump rollback.
          </p>
        </Confirm>
      ) : null}
    </div>
  );
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
          <th className="num">Current</th>
          <th className="num">Candidate</th>
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
          <p className="section-label">Scan</p>
          <p className="meta">{state.scan.purpose}</p>
        </div>
        <div className="page-action">
          <Badge value={state.scan.status} />
          {state.scan.idle ? (
            <Button type="button" disabled={busy} onClick={() => void run()}>
              Run the scan
            </Button>
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
          <p className="section-label">Sunday update</p>
          <p className="meta">Next run {state.update.next}</p>
        </div>
        <div className="page-action">
          <Badge value={state.update.status} />
          <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => void check()}>
            Check for updates
          </Button>
          <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => setDry(true)}>
            Dry run
          </Button>
          {state.update.idle ? (
            <Button type="button" disabled={busy !== ""} onClick={() => setConfirm(true)}>
              Update all
            </Button>
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
              <th className="num">Packages</th>
              <th className="num">Security</th>
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
