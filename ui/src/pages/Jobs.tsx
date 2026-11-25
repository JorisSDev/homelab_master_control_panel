import { useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Table, TableCell, TableHead } from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
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
  return (
    <Page title="Jobs" context="Scheduled work, and the meaning of the last result.">
      <Month state={state} onState={onState} />
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <ScanCard state={state} open={path === "/jobs/scan"} />
        <UpdateCard state={state} onState={onState} open={path === "/jobs/update"} />
      </div>
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
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Pending =
  | { action: "skip"; weekday: number }
  | { action: "restore" }
  | { action: "move"; weekday: number; time: string }
  | { action: "once"; date: string; time: string };

function Month({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const rules = state.calendar?.rules || [];
  const standing = state.calendar?.standing || [];
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date();

  async function apply(action: Pending) {
    setBusy(true);
    setMessage("");
    const body =
      action.action === "skip"
        ? { confirm: true, action: "skip", weekday: action.weekday }
        : action.action === "restore"
          ? { confirm: true, action: "restore" }
          : action.action === "move"
            ? { confirm: true, action: "move", weekday: action.weekday, time: action.time }
            : { confirm: true, action: "once", date: action.date, time: action.time };
    const result = await postJson("/api/jobs/update/schedule", body);
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setMessage(String(result.data.error || "The schedule was not changed."));
      return;
    }
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
    setMessage(action.action === "once" ? "The extra run was scheduled." : action.action === "restore" ? "The update is back on." : "The Sunday update was rescheduled.");
  }

  if (rules.length === 0) {
    return (
      <>
        <Empty>No house jobs were read.</Empty>
        {standing.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {pending ? <ScheduleConfirm pending={pending} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void apply(pending)} /> : null}
      </>
    );
  }

  const cells = monthCells(cursor.year, cursor.month, today);
  return (
    <div className="calendar">
      {message ? <p className={message.endsWith(".") && !message.includes("not") ? "ok" : "bad"}>{message}</p> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div>
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
          <div className="calendar-grid" role="grid" aria-label={`${MONTHS[cursor.month]} ${cursor.year}`}>
            {WEEKDAY_SHORT.map((name) => (
              <div key={name} className="calendar-dow" role="columnheader">
                {name}
              </div>
            ))}
            {cells.map((cell) => {
              const marks = dayMarks(cell.date, rules, state.schedule);
              return (
                <div key={cell.key} className="contents">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        role="gridcell"
                        className={["day", cell.outside ? "outside" : "", cell.today ? "is-today" : ""].filter(Boolean).join(" ")}
                        aria-current={cell.today ? "date" : undefined}
                        aria-label={dayLabel(cell.date, marks)}
                      >
                        <span className="num">{cell.day}</span>
                        {marks.map((mark) => (
                          <span key={mark} className={mark === "Skipped" ? "day-job skipped" : "day-job"}>
                            {mark}
                          </span>
                        ))}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <DayPanel date={cell.date} rules={rules} schedule={state.schedule} today={today} busy={busy} onPending={setPending} />
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        </div>
        <aside data-rail className="grid content-start gap-3 border border-[var(--line)] bg-[var(--paper)] p-4">
          {rules
            .filter((rule) => rule.label !== "Update")
            .map((rule) => (
              <div key={`${rule.label}-${rule.time}`}>
                <p>{rule.label}</p>
                <p className="meta">
                  {cadence(rule)} · {when(rule)}
                </p>
              </div>
            ))}
          {standing.map((line) => (
            <p key={line} className="meta">
              {line}
            </p>
          ))}
        </aside>
      </div>
      {pending ? <ScheduleConfirm pending={pending} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void apply(pending)} /> : null}
    </div>
  );
}

function ScheduleConfirm({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (pending.action === "skip") {
    const day = WEEKDAY_NAMES[pending.weekday] || "Sunday";
    return (
      <Confirm title={`Skip the next ${day}`} confirmLabel="Skip this one" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
        <p>The coming {day} update will not run. The week after returns to the normal time.</p>
      </Confirm>
    );
  }
  if (pending.action === "restore") {
    return (
      <Confirm title="Put the update back" confirmLabel="Put it back" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
        <p>The coming update will run again.</p>
      </Confirm>
    );
  }
  if (pending.action === "move") {
    return (
      <Confirm title="Move the weekly update" confirmLabel="Move weekly time" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
        <p>
          This changes the weekly update to {WEEKDAY_NAMES[pending.weekday]} at {pending.time}. Other jobs stay where they are.
        </p>
      </Confirm>
    );
  }
  return (
    <Confirm title="Schedule one update" confirmLabel="Schedule one run" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <p>
        This starts the update on {pending.date} at {pending.time}. It restarts playback, recreates Compose services, and has no vzdump rollback.
      </p>
    </Confirm>
  );
}

function DayPanel({
  date,
  rules,
  schedule,
  today,
  busy,
  onPending,
}: {
  date: Date;
  rules: CalendarRule[];
  schedule: ViewState["schedule"];
  today: Date;
  busy: boolean;
  onPending: (pending: Pending) => void;
}) {
  const key = dateKey(date);
  const weekly = updateRule(rules);
  const past = startOf(date) < startOf(today);
  const onWeekly = weekly !== null && weekdayIndex(date) === weekly.weekday;
  const nextKey = weekly ? dateKey(nextWeekly(weekly.weekday, today)) : "";
  const skipped = schedule?.skip === key;
  const onceHere = schedule?.once === key;
  return (
    <div className="grid gap-3">
      <p className="font-semibold">
        {WEEKDAY_NAMES[weekdayIndex(date)]} {date.getDate()} {MONTHS[date.getMonth()]}
      </p>
      {past ? <p>This day has passed.</p> : null}
      {!past && skipped ? (
        <div className="grid gap-2">
          <p>This update is skipped. The week after returns to the normal time.</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onPending({ action: "restore" })}>
            Put it back
          </Button>
        </div>
      ) : null}
      {!past && onceHere && onWeekly ? <p>An extra update is also set for {schedule?.once_time}.</p> : null}
      {!past && !skipped && onWeekly && weekly ? (
        <WeeklyEditor
          weekday={weekly.weekday}
          time={weekly.time}
          canSkip={key === nextKey}
          busy={busy}
          onSkip={() => onPending({ action: "skip", weekday: weekly.weekday })}
          onMove={(weekday, time) => onPending({ action: "move", weekday, time })}
        />
      ) : null}
      {!past && !onWeekly && onceHere ? <p>An extra update is set for {schedule?.once_time}.</p> : null}
      {!past && !onWeekly && !onceHere && schedule?.once ? (
        <p>
          An extra update is already set for {schedule.once}
          {schedule.once_time ? ` at ${schedule.once_time}` : ""}.
        </p>
      ) : null}
      {!past && !onWeekly && !onceHere && !schedule?.once ? <OnceEditor date={key} busy={busy} onOnce={(time) => onPending({ action: "once", date: key, time })} /> : null}
    </div>
  );
}

function WeeklyEditor({
  weekday,
  time,
  canSkip,
  busy,
  onSkip,
  onMove,
}: {
  weekday: number;
  time: string;
  canSkip: boolean;
  busy: boolean;
  onSkip: () => void;
  onMove: (weekday: number, time: string) => void;
}) {
  const [day, setDay] = useState(String(weekday));
  const [clock, setClock] = useState(time);
  const dirty = Number(day) !== weekday || clock !== time;
  return (
    <div className="grid gap-3">
      <p>
        Repeats every {WEEKDAY_NAMES[weekday]} at {time}.
      </p>
      <ToggleGroup type="single" value={day} onValueChange={(value) => { if (value) setDay(value); }} aria-label="Weekly day" className="flex-wrap">
        {WEEKDAY_SHORT.map((name, index) => (
          <ToggleGroupItem key={name} value={String(index)} aria-label={WEEKDAY_NAMES[index]}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <label className="grid gap-1">
        Time
        <Input type="time" value={clock} onChange={(event) => setClock(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {canSkip ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onSkip}>
            Skip this one
          </Button>
        ) : null}
        {dirty ? (
          <Button type="button" disabled={busy || !clock} onClick={() => onMove(Number(day), clock)}>
            Save
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OnceEditor({ date, busy, onOnce }: { date: string; busy: boolean; onOnce: (time: string) => void }) {
  const [clock, setClock] = useState("06:00");
  return (
    <div className="grid gap-3">
      <p>Run the update once on {date}. The weekly update stays where it is.</p>
      <label className="grid gap-1">
        Time
        <Input type="time" value={clock} onChange={(event) => setClock(event.target.value)} />
      </label>
      <Button type="button" disabled={busy || !clock} onClick={() => onOnce(clock)}>
        Schedule one run
      </Button>
    </div>
  );
}

function shiftMonth(current: { year: number; month: number }, delta: number) {
  const next = new Date(current.year, current.month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function monthCells(year: number, month: number, today: Date) {
  const first = new Date(year, month, 1);
  const lead = weekdayIndex(first);
  const start = new Date(year, month, 1 - lead);
  const last = new Date(year, month + 1, 0);
  const trail = 6 - weekdayIndex(last);
  const total = lead + last.getDate() + trail;
  const cells: { key: string; day: number; date: Date; outside: boolean; today: boolean }[] = [];
  for (let index = 0; index < total; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    cells.push({
      key: dateKey(date),
      day: date.getDate(),
      date,
      outside: date.getMonth() !== month,
      today: dateKey(date) === dateKey(today),
    });
  }
  return cells;
}

function dayMarks(date: Date, rules: CalendarRule[], schedule: ViewState["schedule"]) {
  const key = dateKey(date);
  const weekly = updateRule(rules);
  const marks: string[] = [];
  if (schedule?.skip === key) {
    marks.push("Skipped");
  } else if (weekly && weekdayIndex(date) === weekly.weekday) {
    marks.push(weekly.time);
  }
  if (schedule?.once === key && schedule.once_time) {
    marks.push(`Once ${schedule.once_time}`);
  }
  return marks;
}

function dayLabel(date: Date, marks: string[]) {
  const label = `${WEEKDAY_NAMES[weekdayIndex(date)]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return marks.length ? `${label}, ${marks.join(", ")}` : label;
}

function updateRule(rules: CalendarRule[]) {
  const rule = rules.find((item) => item.label === "Update" && Array.isArray(item.weekdays) && item.weekdays.length > 0);
  if (!rule || !rule.weekdays) {
    return null;
  }
  return { weekday: rule.weekdays[0], time: rule.time };
}

function weekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function startOf(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function nextWeekly(weekday: number, today: Date) {
  const delta = (weekday - weekdayIndex(today) + 7) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
}

function cadence(rule: CalendarRule) {
  if (!rule.weekdays || rule.weekdays.length === 0) {
    return "Every day";
  }
  return rule.weekdays.map((day) => WEEKDAY_NAMES[day] || "").filter(Boolean).join(", ");
}

function when(rule: { time: string; until?: string }) {
  return rule.until ? `${rule.time}–${rule.until}` : rule.time;
}

function dateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function ScanCard({ state, open }: { state: ViewState; open: boolean }) {
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
    <Card className="figure grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">Scan</p>
          <p>
            {state.scan.detail}
            {state.scan.elapsed ? ` · ${state.scan.elapsed}` : ""}
          </p>
        </div>
        <Badge value={state.scan.status} />
      </div>
      {state.scan.lock ? <p>{state.scan.lock}</p> : null}
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      {state.scan.idle ? (
        <Button type="button" disabled={busy} onClick={() => void run()}>
          Run the scan
        </Button>
      ) : (
        <Timeline steps={state.scan.timeline} />
      )}
      <Collapsible defaultOpen={open}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline">
            Details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid gap-3">
          {state.scan.purpose ? <p>{state.scan.purpose}</p> : null}
          {state.scan.idle ? <Timeline steps={state.scan.timeline} /> : null}
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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Timeline({ steps }: { steps: ViewState["scan"]["timeline"] }) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.text} className={step.current ? "step-current" : ""}>
          {step.current ? <span>Now</span> : null}
          {step.text}
        </li>
      ))}
    </ol>
  );
}

function UpdateCard({ state, onState, open }: { state: ViewState; onState: (next: ViewState) => void; open: boolean }) {
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
    <Card className="figure grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">Sunday update</p>
          <p>Next run {state.update.next}</p>
          <p className="meta">Host packages</p>
          <p>{waitingLine(state)}</p>
        </div>
        <Badge value={state.update.status} />
      </div>
      {message ? <p className={message.startsWith("Starting") || message.startsWith("Checked") ? "ok" : "bad"}>{message}</p> : null}
      <p>
        {state.update.detail}
        {state.update.elapsed ? ` · ${state.update.elapsed}` : ""}
      </p>
      {state.guest_updates.active ? <p>{guestName(state, state.guest_updates.active)} is updating</p> : null}
      <div className="flex flex-wrap gap-2">
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
      <Collapsible defaultOpen={open}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline">
            Details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid gap-3">
          <HostPackages state={state} />
          {(state.update.history[0]?.steps || []).map((step) => (
            <p key={step}>{step}</p>
          ))}
          {rows.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <TableHead>Guest</TableHead>
                  <TableHead className="num">Packages</TableHead>
                  <TableHead className="num">Security</TableHead>
                  <TableHead>Compose</TableHead>
                  <TableHead>Reboot</TableHead>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell className="num">{row.packages}</TableCell>
                    <TableCell className="num">{row.security}</TableCell>
                    <TableCell>{row.compose.join(", ") || (row.floating ? "floating tag" : "—")}</TableCell>
                    <TableCell>{row.reboot ? "wanted" : "—"}</TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
      {confirm ? (
        <Confirm title="Start the update" confirmLabel="Start the update" busy={busy !== ""} onCancel={() => setConfirm(false)} onConfirm={() => void start("update")}>
          <p>This restarts playback, recreates Compose services, and has no vzdump rollback.</p>
        </Confirm>
      ) : null}
      {dry ? (
        <Confirm title="Start the dry run" confirmLabel="Start the dry run" busy={busy !== ""} onCancel={() => setDry(false)} onConfirm={() => void start("dry")}>
          <p>This previews the Sunday update and does not install packages.</p>
        </Confirm>
      ) : null}
    </Card>
  );
}

function waitingLine(state: ViewState) {
  const packages = state.packages;
  const guests = state.guest_updates.rows.filter((row) => row.packages > 0 || row.security > 0 || row.compose.length > 0 || row.floating || row.reboot).length;
  if (!packages.checked && !state.guest_updates.checked) {
    return "Not checked.";
  }
  if ((packages.total || 0) === 0 && guests === 0) {
    return "Nothing is waiting.";
  }
  const parts: string[] = [];
  if (packages.checked) {
    parts.push(`${packages.total ?? 0} host packages`);
    parts.push(`${packages.security ?? 0} security`);
  }
  if (guests > 0) {
    parts.push(`${guests} ${guests === 1 ? "guest" : "guests"} waiting`);
  }
  return parts.join(" · ");
}

function guestName(state: ViewState, id: string) {
  return state.services.rows.find((row) => row.id === id)?.name || id;
}

function HostPackages({ state }: { state: ViewState }) {
  const packages = state.packages;
  if (!packages.checked || !packages.total) {
    return null;
  }
  return (
    <Table>
      <thead>
        <tr>
          <TableHead>Host packages</TableHead>
          <TableHead className="num">Current</TableHead>
          <TableHead className="num">Candidate</TableHead>
          <TableHead>Kind</TableHead>
        </tr>
      </thead>
      <tbody>
        {packages.upgrades.map((row) => (
          <tr key={row.name} className={row.security ? "row-security" : "row-candidate"}>
            <TableCell>{row.name}</TableCell>
            <TableCell className="num">{row.current}</TableCell>
            <TableCell className="num">{row.candidate}</TableCell>
            <TableCell>{row.security ? "Security" : "Other"}</TableCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
