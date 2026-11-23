export type TimelineStep = {
  text: string;
  current: boolean;
  guest: string;
  step: string;
  elapsed: string;
};

export type TimerRow = {
  unit: string;
  next: string;
  last: string;
  note?: string;
};

export type Run = {
  heading: string;
  ok: boolean;
  result: string;
  steps: string[];
  transcript: string;
  hidden_lines: number;
};

export type JobView = {
  purpose: string;
  idle: boolean;
  status: string;
  detail: string;
  summary: string;
  next: string;
  note: string;
  started: string;
  elapsed: string;
  timeline: TimelineStep[];
  waiting: boolean;
  lock: string;
  history: Run[];
  security: number | null;
  pending: number | null;
  dry: boolean;
  last_result: string;
};

export type Card = {
  id: Section;
  title: string;
  status: string;
  detail: string;
};

export type Section = "home" | "update" | "scan" | "health" | "panel";

export type ViewState = {
  refresh_seconds: number;
  home: { cards: Card[] };
  update: JobView;
  scan: JobView;
  health: {
    purpose: string;
    status: string;
    summary: string;
    load: string;
    memory_used: string;
    memory_total: string;
    disk_free: string;
    disk_total: string;
    disk_check: { next: string; last: string };
    housekeeping: TimerRow[];
  };
  panel: {
    version: string;
    latest: string;
    update_available: boolean;
    error: string;
  };
};
