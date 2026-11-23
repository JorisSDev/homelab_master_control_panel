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

export type Section = "home" | "findings" | "services" | "storage" | "update" | "scan" | "health" | "panel";

export type ServiceRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  url: string;
};

export type StorageRow = {
  label: string;
  kind: string;
  free: string;
  total: string;
  status: string;
  low: boolean;
};

export type Finding = {
  job: string;
  guest: string;
  result: string;
  heading: string;
  transcript: string;
  hidden_lines: number;
};

export type Packages = {
  checked: boolean;
  total: number | null;
  security: number | null;
  pending: number | null;
  names: string[];
  error: string;
};

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
  services: {
    purpose: string;
    status: string;
    summary: string;
    rows: ServiceRow[];
  };
  storage: {
    purpose: string;
    status: string;
    summary: string;
    rows: StorageRow[];
  };
  findings: {
    purpose: string;
    status: string;
    summary: string;
    count: number;
    items: Finding[];
  };
  packages: Packages;
  panel: {
    version: string;
    latest: string;
    update_available: boolean;
    error: string;
  };
};
