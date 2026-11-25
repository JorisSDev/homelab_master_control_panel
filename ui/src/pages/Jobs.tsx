import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Confirm, Empty, Notice, Page, RouteLink } from "../components/Chrome";
import { ContainerPatchDetails, patchStatusOf } from "../components/PatchStatus";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Table, TableCell, TableHead } from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { postJson, readSnapshot, useMediaQuery } from "../lib";
import type { CalendarRule, JobView, Run, ViewState } from "../types";
import { MaintenanceHistory, MaintenanceUpdates } from "./MaintenanceUpdates";

export function Jobs({
  state,
  path,
  onState,
  go,
}: {
  state: ViewState;
  path: string;
  onState: (next: ViewState) => void;
  go: (path: string) => void;
}) {
  const [updateBusy, setUpdateBusy] = useState<UpdateBusy>("");
  const view = path === "/jobs/scan" ? "scan" : path === "/jobs/history" ? "history"
    : path === "/jobs/update" || path === "/jobs/schedule" ? "schedule" : "updates";
  useEffect(() => {
    const id = path === "/jobs/scan" ? "scan-job" : path === "/jobs/update" ? "update-job"
      : path === "/jobs/patches" ? "patch-checks" : path === "/jobs/history" ? "job-history"
      : path === "/jobs/schedule" ? "job-schedule" : "";
    if (id) document.getElementById(id)?.focus();
  }, [path]);

  const tabs = [
    { key: "updates", label: "Updates", href: "/jobs" },
    { key: "schedule", label: "Schedule", href: "/jobs/schedule" },
    { key: "scan", label: "Scan", href: "/jobs/scan" },
    { key: "history", label: "History", href: "/jobs/history" },
  ];
  const held = state.maintenance?.legacy_paused === true;
  return (
    <Page title="Jobs">
      <nav className="jobs-nav" aria-label="Job views">
        {tabs.map(tab => <RouteLink key={tab.key} href={tab.href} go={go}
          aria-current={view === tab.key ? "page" : undefined}>{tab.label}</RouteLink>)}
      </nav>
      {view === "updates" ? (
        <>
          <MaintenanceUpdates state={state} onState={onState} />
          <PackageChecks state={state} onState={onState} open={path === "/jobs/patches"}
            busy={updateBusy} onBusy={setUpdateBusy} />
        </>
      ) : null}
      {view === "schedule" ? (
        <div className="jobs-view" id="job-schedule" tabIndex={-1}>
          {held ? <Notice message="The legacy full update is on hold. Check recovery evidence before planning a full run." /> : null}
          <Month state={state} onState={onState} />
          <UpdateCard state={state} busy={updateBusy} onBusy={setUpdateBusy} />
        </div>
      ) : null}
      {view === "scan" ? <ScanCard state={state} open /> : null}
      {view === "history" ? (
        <section className="surface-card section-panel" id="job-history" tabIndex={-1}>
          <h2 className="section-title">Maintenance history</h2>
          <MaintenanceHistory state={state} />
          <RunHistory label="Full update history" job={state.update} />
          <RunHistory label="Scan history" job={state.scan} />
        </section>
      ) : null}
    </Page>
  );
}

const monthLabel = new Intl.DateTimeFormat("lt-LT", { year: "numeric", month: "long" });
const calendarDate = new Intl.DateTimeFormat("lt-LT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const mondayFirst = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index));
const WEEKDAY_SHORT = mondayFirst.map(new Intl.DateTimeFormat("lt-LT", { weekday: "short" }).format);
const WEEKDAY_NAMES = mondayFirst.map(new Intl.DateTimeFormat("lt-LT", { weekday: "long" }).format);
const CLOCK_PATTERN = "(?:[01][0-9]|2[0-3]):[0-5][0-9]";
const validClock = new RegExp(`^${CLOCK_PATTERN}$`);

type Pending =
  | { action: "skip"; weekday: number }
  | { action: "restore" }
  | { action: "move"; weekday: number; time: string }
  | { action: "once"; date: string; time: string };

function Month({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const held = state.maintenance?.legacy_paused === true;
  const rules = state.calendar?.rules || [];
  const standing = state.calendar?.standing || [];
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<Date | null>(null);
  const [focusDay, setFocusDay] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const openingConfirm = useRef(false);
  const phone = useMediaQuery("(max-width: 767px)");
  const today = new Date();

  async function apply(action: Pending) {
    if (held) return;
    setBusy(true);
    setMessage(null);
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
    const success = action.action === "once" ? "The extra run was scheduled." :
      action.action === "restore" ? "The update is back on." : "The Sunday update was rescheduled.";
    setMessage({ ok: result.ok, text: result.ok ? success : String(result.data.error || "The schedule was not changed.") });
    if (result.ok) {
      const snapshot = await readSnapshot();
      if (snapshot) onState(snapshot);
    }
  }

  function openConfirmation(action: Pending) {
    if (!selected) return;
    returnFocus.current = buttons.current.get(dateKey(selected)) || null;
    openingConfirm.current = true;
    setSelected(null);
    setPending(action);
  }

  function restoreDayFocus(event: Event) {
    if (!openingConfirm.current) return;
    event.preventDefault();
    openingConfirm.current = false;
  }

  const cells = monthCells(cursor.year, cursor.month, today);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const tabDay = cells.find((cell) => cell.key === focusDay)?.key || cells.find((cell) => cell.today)?.key || cells.find((cell) => !cell.outside)?.key;
  const selectedKey = selected ? dateKey(selected) : "";
  const month = monthLabel.format(new Date(cursor.year, cursor.month, 1));
  const weekly = held ? null : updateRule(rules);
  const hasSkippedDay = cells.some((cell) => cell.key === state.schedule?.skip);
  const hasExtraDay = !held && cells.some((cell) => cell.key === state.schedule?.once && state.schedule.once_time);
  const hasScheduleNotes = rules.some((rule) => rule.label !== "Update") || standing.length > 0;

  function moveDay(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    switch (event.key) {
      case "ArrowLeft": next -= 1; break;
      case "ArrowRight": next += 1; break;
      case "ArrowUp": next -= 7; break;
      case "ArrowDown": next += 7; break;
      case "Home": next -= index % 7; break;
      case "End": next += 6 - index % 7; break;
      default: return;
    }
    event.preventDefault();
    if (cells[next]) buttons.current.get(cells[next].key)?.focus();
  }

  return (
    <section className="surface-card calendar">
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      {!rules.length ? (
        <><h2 className="section-title">Schedule</h2><Empty>No house jobs were read.</Empty>
          {standing.map((line) => <p className="meta" key={line}>{line}</p>)}</>
      ) : (
        <div className={hasScheduleNotes ? "calendar-layout with-notes" : "calendar-layout"}>
          <div className="calendar-main">
            <div className="calendar-nav">
              <h2 className="section-title"><CalendarDays aria-hidden="true" /><span lang="lt">{month}</span></h2>
              <div className="row-actions">
                <Button type="button" variant="outline" size="icon" aria-label="Previous month" onClick={() => setCursor((current) => shiftMonth(current, -1))}><ChevronLeft aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" aria-label="Next month" onClick={() => setCursor((current) => shiftMonth(current, 1))}><ChevronRight aria-hidden="true" /></Button>
              </div>
            </div>
            <div className="calendar-grid" role="grid" aria-label={month}>
              <div className="calendar-week" role="row">
                {WEEKDAY_SHORT.map((name, index) => <div key={name} className="calendar-dow" role="columnheader" lang="lt" aria-label={WEEKDAY_NAMES[index]}>{name}</div>)}
              </div>
              {weeks.map((week, weekIndex) => (
                <div className="calendar-week" key={week[0].key} role="row">
                  {week.map((cell, dayIndex) => {
                    const marks = dayMarks(cell.date, rules, state.schedule, held);
                    const active = selectedKey === cell.key;
                    const trigger = (
                      <button type="button" className="day" data-date={cell.key} data-outside={cell.outside || undefined} data-today={cell.today || undefined}
                        data-selected={active || undefined} tabIndex={cell.key === tabDay ? 0 : -1}
                        aria-current={cell.today ? "date" : undefined} aria-label={dayLabel(cell.date, marks)}
                        ref={(node) => { if (node) buttons.current.set(cell.key, node); else buttons.current.delete(cell.key); }}
                        onFocus={() => setFocusDay(cell.key)} onKeyDown={(event) => moveDay(event, weekIndex * 7 + dayIndex)}
                        onClick={phone ? () => setSelected(cell.date) : undefined}
                        aria-haspopup={phone ? "dialog" : undefined}
                      >
                        <span className="day-number num">{cell.day}</span>
                        <span className="day-events" aria-hidden="true">{marks.map((mark) => (
                          <span key={mark} className={mark === "Skipped" ? "day-job skipped" : mark.startsWith("Once") ? "day-job extra" : "day-job"}>
                            <i /><span>{mark}</span>
                          </span>
                        ))}</span>
                      </button>
                    );
                    return (
                      <div key={cell.key} role="gridcell" aria-selected={active} className="calendar-cell">
                        {phone ? trigger : (
                          <Popover open={active} onOpenChange={(open) => setSelected(open ? cell.date : null)}>
                            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                            <PopoverContent onCloseAutoFocus={restoreDayFocus} aria-label={dayLabel(cell.date, [])}>
                              <DayPanel date={cell.date} rules={rules} schedule={state.schedule} today={today} busy={busy} held={held} onPending={openConfirmation} />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {weekly || hasSkippedDay || hasExtraDay ? (
              <ul className="calendar-legend" aria-label="Calendar key">
                {weekly ? <li><i aria-hidden="true" /><span>Weekly update · <span lang="lt">{WEEKDAY_NAMES[weekly.weekday]}</span> · {weekly.time}</span></li> : null}
                {hasSkippedDay ? <li className="skipped"><i aria-hidden="true" />Skipped run</li> : null}
                {hasExtraDay ? <li className="extra"><i aria-hidden="true" />Extra run</li> : null}
              </ul>
            ) : null}
          </div>
          {hasScheduleNotes ? (
            <aside data-rail className="calendar-notes">
              <h3>Schedule notes</h3>
              {rules.filter((rule) => rule.label !== "Update").map((rule) => (
                <div key={`${rule.label}-${rule.time}`}><p>{rule.label}</p><p className="meta">{cadence(rule)} · {when(rule)}</p></div>
              ))}
              {standing.map((line) => <p key={line} className="meta">{line}</p>)}
            </aside>
          ) : null}
        </div>
      )}
      {phone && selected ? (
        <Sheet open onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <SheetContent side="bottom" className="calendar-sheet" onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (openingConfirm.current) openingConfirm.current = false;
            else buttons.current.get(selectedKey)?.focus();
          }}>
            <SheetTitle>{dayLabel(selected, [])}</SheetTitle>
            <DayPanel date={selected} rules={rules} schedule={state.schedule} today={today} busy={busy} held={held} onPending={openConfirmation} hideDate />
          </SheetContent>
        </Sheet>
      ) : null}
      {pending && !held ? <ScheduleConfirm pending={pending} busy={busy} returnFocus={returnFocus.current} onCancel={() => setPending(null)} onConfirm={() => void apply(pending)} /> : null}
    </section>
  );
}

function ScheduleConfirm({
  pending,
  busy,
  onCancel,
  onConfirm,
  returnFocus,
}: {
  pending: Pending;
  busy: boolean;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (pending.action === "skip") {
    return (
      <Confirm title="Skip the next weekly update" confirmLabel="Skip this one" busy={busy} onCancel={onCancel} onConfirm={onConfirm} returnFocus={returnFocus}>
        <p>The next update is scheduled for <span lang="lt">{WEEKDAY_NAMES[pending.weekday]}</span>. The week after returns to the normal time.</p>
      </Confirm>
    );
  }
  if (pending.action === "restore") {
    return (
      <Confirm title="Put the update back" confirmLabel="Put it back" busy={busy} onCancel={onCancel} onConfirm={onConfirm} returnFocus={returnFocus}>
        <p>The coming update will run again.</p>
      </Confirm>
    );
  }
  if (pending.action === "move") {
    return (
      <Confirm title="Move the weekly update" confirmLabel="Move weekly time" busy={busy} onCancel={onCancel} onConfirm={onConfirm} returnFocus={returnFocus}>
        <p>
          This changes the weekly update to {WEEKDAY_NAMES[pending.weekday]} at {pending.time}. Other jobs stay where they are.
        </p>
      </Confirm>
    );
  }
  return (
    <Confirm destructive title="Schedule one update" confirmLabel="Schedule one run" busy={busy} onCancel={onCancel} onConfirm={onConfirm} returnFocus={returnFocus}>
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
  held,
  onPending,
  hideDate = false,
}: {
  date: Date;
  hideDate?: boolean;
  rules: CalendarRule[];
  schedule: ViewState["schedule"];
  today: Date;
  busy: boolean;
  held: boolean;
  onPending: (pending: Pending) => void;
}) {
  if (held) return <p className="day-editor">The legacy full update is on hold.</p>;
  const key = dateKey(date);
  const weekly = updateRule(rules);
  const past = startOf(date) < startOf(today);
  const onWeekly = weekly !== null && weekdayIndex(date) === weekly.weekday;
  const nextKey = weekly ? dateKey(nextWeekly(weekly.weekday, today)) : "";
  const skipped = schedule?.skip === key;
  const onceHere = schedule?.once === key;
  return (
    <div className="day-editor">
      {hideDate ? null : <h3 className="section-title">{dayLabel(date, [])}</h3>}
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
        Weekly · <span lang="lt">{WEEKDAY_NAMES[weekday]}</span> · {time}
      </p>
      <ToggleGroup type="single" value={day} onValueChange={(value) => { if (value) setDay(value); }} aria-label="Weekly day" className="weekday-picker flex-wrap">
        {WEEKDAY_SHORT.map((name, index) => (
          <ToggleGroupItem key={name} value={String(index)} lang="lt" aria-label={WEEKDAY_NAMES[index]}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <TimeField clock={clock} onChange={setClock} />
      <div className="flex flex-wrap gap-2">
        {canSkip ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onSkip}>
            Skip this one
          </Button>
        ) : null}
        {dirty ? (
          <Button type="button" disabled={busy || !validClock.test(clock)} onClick={() => onMove(Number(day), clock)}>
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
      <TimeField clock={clock} onChange={setClock} />
      <Button type="button" disabled={busy || !validClock.test(clock)} onClick={() => onOnce(clock)}>
        Schedule one run
      </Button>
    </div>
  );
}

function TimeField({ clock, onChange }: { clock: string; onChange: (clock: string) => void }) {
  return (
    <label className="grid gap-1">
      Time (24-hour, HH:MM)
      <Input type="text" name="time" placeholder="06:00" maxLength={5} pattern={CLOCK_PATTERN} value={clock} onChange={(event) => onChange(event.target.value)} />
    </label>
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

function dayMarks(date: Date, rules: CalendarRule[], schedule: ViewState["schedule"], held: boolean) {
  const key = dateKey(date);
  const weekly = updateRule(rules);
  const marks: string[] = [];
  if (schedule?.skip === key) {
    marks.push("Skipped");
  } else if (!held && weekly && weekdayIndex(date) === weekly.weekday) {
    marks.push(weekly.time);
  }
  if (!held && schedule?.once === key && schedule.once_time) {
    marks.push(`Once ${schedule.once_time}`);
  }
  return marks;
}

function dayLabel(date: Date, marks: string[]) {
  const label = calendarDate.format(date);
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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(open);
  useEffect(() => { if (open) setDetailsOpen(true); }, [open]);
  const meaning = state.scan_meaning;
  const plex = state.plex;

  async function run() {
    setBusy(true);
    setMessage(null);
    const result = await postJson("/api/actions/scan");
    setBusy(false);
    setMessage({ ok: result.ok, text: result.ok ? "Starting the scan." : String(result.data.error || "The scan did not start.") });
  }

  return (
    <Card className="job-panel" id="scan-job" tabIndex={-1} role="region" aria-label="Scan">
      <div className="section-heading"><h2 className="section-title">Scan</h2><Badge value={state.scan.status} /></div>
      <p className="job-description">{state.scan.detail}{state.scan.elapsed ? ` · ${state.scan.elapsed}` : ""}</p>
      <Notice tone="warning" message={state.scan.lock || ""} />
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      {state.scan.idle ? (
        <div className="row-actions"><Button type="button" disabled={busy} onClick={() => void run()}>{busy ? "Starting scan…" : "Run the scan"}</Button></div>
      ) : <Timeline steps={state.scan.timeline} />}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="job-details-toggle">
            Details <ChevronRight aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="job-details">
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
      <RunHistory label="Scan history" job={state.scan} />
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

type UpdateBusy = "" | "check" | "dry" | "update";
type UpdateActionProps = { state: ViewState; busy: UpdateBusy; onBusy: (next: UpdateBusy) => void };

function PackageChecks({ state, onState, open, busy, onBusy }: UpdateActionProps & { onState: (next: ViewState) => void; open: boolean }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(open);
  useEffect(() => { if (open) setDetailsOpen(true); }, [open]);
  const patch = patchStatusOf(state);

  async function check() {
    onBusy("check");
    setMessage(null);
    const host = await postJson("/api/packages/check");
    const guests = await postJson("/api/guests/check");
    onBusy("");
    const rows = guests.data.rows;
    const partial = Array.isArray(rows) && rows.some((row) => row?.error);
    const ok = host.ok && guests.ok && host.data.checked !== false && guests.data.checked !== false
      && !host.data.error && !guests.data.error && !partial;
    setMessage({ ok, text: ok ? "Package results refreshed." : String(guests.data.error || host.data.error || "Some package checks did not finish. See Details for results.") });
    if (host.ok || guests.ok) {
      const snapshot = await readSnapshot();
      if (snapshot) onState(snapshot);
    }
  }

  return (
    <Card className="job-panel" id="patch-checks" tabIndex={-1} role="region" aria-labelledby="patch-checks-title">
      <div className="section-heading">
        <h2 className="section-title" id="patch-checks-title">Package and security checks</h2>
        <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => void check()}>{busy === "check" ? "Checking packages…" : "Check packages"}</Button>
      </div>
      <p className="meta">Check local APT candidates for the host and eligible running containers.</p>
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="job-details-toggle">
            Details <ChevronRight aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="job-details">
          <dl className="job-summary">
            <div><dt className="meta">Host packages</dt><dd>{patch.host}</dd></div>
            <div><dt className="meta">Container packages</dt><dd>{patch.containers}</dd></div>
          </dl>
          <h3>Application versions</h3>
          <p className={patch.plex?.version_status === "below" ? "patch-review" : undefined}>{patch.application}</p>
          {patch.plex?.version || patch.plex?.minimum ? (
            <dl className="fact-list">
              <div><dt>Running Plex version</dt><dd className="technical">{patch.plex.version || "Unavailable"}</dd></div>
              <div><dt>Configured minimum</dt><dd className="technical">{patch.plex.minimum || "Not set"}</dd></div>
            </dl>
          ) : null}
          <p className="meta">Package checks use local APT lists and count candidates marked Debian Security. Results have no recorded check time. VM packages, Compose images, and standalone applications have separate update sources.</p>
          {state.packages.error ? <p className="meta">{state.packages.error}</p> : null}
          <HostPackages state={state} />
          <h3>Container packages</h3>
          <p className={patch.containerCounts.security ? "patch-review" : undefined}>{patch.containers}</p>
          {patch.running > 0 ? <p className="meta">{patch.reported} of {patch.running} running containers reported</p> : null}
          {state.guest_updates.error ? <p className="meta">{state.guest_updates.error}</p> : null}
          <ContainerPatchDetails patch={patch} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function UpdateCard({ state, busy, onBusy }: UpdateActionProps) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dry, setDry] = useState(false);

  async function start(kind: "update" | "dry") {
    onBusy(kind);
    setMessage(null);
    const result = await postJson("/api/actions/update", kind === "dry" ? { confirm: true, dry: true } : { confirm: true });
    onBusy("");
    setConfirm(false);
    setDry(false);
    setMessage({ ok: result.ok, text: result.ok ? kind === "dry" ? "Starting the dry run." : "Starting the full update." : String(result.data.error || "The update did not start.") });
  }

  return (
    <Card className="job-panel" id="update-job" tabIndex={-1} role="region" aria-labelledby="full-update-title">
      <div className="section-heading"><h2 className="section-title" id="full-update-title">Full stack update</h2><Badge value={state.update.status} /></div>
      <div className="job-summary">
        <div><span className="meta">Next run</span><strong className="num">{state.maintenance?.legacy_paused === true ? "On hold" : state.update.next}</strong></div>
        {state.schedule?.skip ? <div><span className="meta">Skipped occurrence</span><strong className="num">{state.schedule.skip}</strong></div> : null}
      </div>
      <p className="job-description">Upgrades container packages, pulls images, can recreate Compose services, and applies host security updates.</p>
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      <p className="job-description">{state.update.detail}{state.update.elapsed ? ` · ${state.update.elapsed}` : ""}</p>
      {state.guest_updates.active ? <Notice message={`${guestName(state, state.guest_updates.active)} is updating`} /> : null}
      {state.maintenance?.legacy_paused === true ? null : <div className="row-actions">
        <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => setDry(true)}>Preview full update</Button>
        {state.update.idle ? <Button type="button" variant="destructive" disabled={busy !== ""} onClick={() => setConfirm(true)}>Run full update</Button> : null}
      </div>}
      <RunHistory label="Update history" job={state.update} />
      {confirm ? (
        <Confirm destructive title="Start the full stack update" confirmLabel="Start full update" busy={busy !== ""} onCancel={() => setConfirm(false)} onConfirm={() => void start("update")}>
          <p>This upgrades container packages and may interrupt playback and recreate Compose services. Verify usable backups for affected apps before continuing.</p>
        </Confirm>
      ) : null}
      {dry ? (
        <Confirm title="Start the dry run" confirmLabel="Start the dry run" busy={busy !== ""} onCancel={() => setDry(false)} onConfirm={() => void start("dry")}>
          <p>The preview simulates upgrades and validates Compose configuration. It may refresh package lists and finish configuring pending packages.</p>
        </Confirm>
      ) : null}
    </Card>
  );
}

function RunHistory({ label, job }: { label: string; job: JobView }) {
  return (
    <section className="run-history" aria-label={label}>
      <h3>{label}</h3>
      {job.history.length === 0 ? (
        <Empty>No runs have been recorded.</Empty>
      ) : (
        <ol>
          {job.history.map((run, index) => <RunHistoryEntry key={run.started_at || `${run.heading}-${index}`} run={run} />)}
        </ol>
      )}
    </section>
  );
}

function RunHistoryEntry({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const incomplete = run.result === "incomplete";
  const status = run.ok ? "Completed" : incomplete ? "Incomplete" : "Needs attention";
  const result = incomplete ? "" : run.result;
  return (
    <li>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <ChevronRight className="run-chevron" size={16} aria-hidden="true" />
          {run.started_at ? <time className="num" dateTime={run.started_at}>{run.heading}</time> : <span className="num">{run.heading}</span>}
          <Badge value={status} />
        </summary>
        {open ? (
          <div className="run-details">
            {result ? <p>{result}</p> : null}
            {run.steps.length > 0 ? (
              <ol className="run-steps">
                {run.steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
              </ol>
            ) : null}
            {run.transcript ? <pre tabIndex={0} aria-label="Run log">{run.transcript}</pre> : null}
            {run.hidden_lines ? <p className="meta">{run.hidden_lines} additional log lines omitted.</p> : null}
            {!run.transcript && !run.steps.length && !result ? <Empty>No run details were recorded.</Empty> : null}
          </div>
        ) : null}
      </details>
    </li>
  );
}

function guestName(state: ViewState, id: string) {
  return state.services.rows.find((row) => row.id === id)?.name || id;
}

function HostPackages({ state }: { state: ViewState }) {
  const packages = state.packages;
  if (!packages.checked || packages.error || !packages.upgrades.length) {
    return null;
  }
  const upgrades = [...packages.upgrades].sort((a, b) => Number(b.security) - Number(a.security));
  return (
    <div className="host-packages">
      <div className="table-scroll host-packages-table"><Table aria-label="Host packages">
        <thead>
          <tr>
            <TableHead>Host packages</TableHead>
            <TableHead className="num">Current</TableHead>
            <TableHead className="num">Candidate</TableHead>
            <TableHead>Kind</TableHead>
          </tr>
        </thead>
        <tbody>
          {upgrades.map((row) => (
            <tr key={row.name} className={row.security ? "row-security" : "row-candidate"}>
              <TableCell>{row.name}</TableCell>
              <TableCell className="num">{row.current}</TableCell>
              <TableCell className="num">{row.candidate}</TableCell>
              <TableCell>{row.security ? "Security" : "Other"}</TableCell>
            </tr>
          ))}
        </tbody>
      </Table></div>
      <ul className="patch-machines host-packages-list" aria-label="Host packages">
        {upgrades.map((row) => (
          <li key={row.name}>
            <div className="patch-machine"><strong>{row.name}</strong><span className={row.security ? "patch-review" : undefined}>{row.security ? "Security" : "Other"}</span></div>
            <dl className="fact-list">
              <div><dt>Current</dt><dd className="technical">{row.current}</dd></div>
              <div><dt>Candidate</dt><dd className="technical">{row.candidate}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
