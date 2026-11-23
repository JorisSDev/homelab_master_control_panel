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

export type Section = "home" | "services" | "storage" | "update" | "scan" | "panel";

export type ServiceRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  url: string;
  services: string[];
  cpu: string;
  memory: string;
  disk: string;
};

export type StorageRow = {
  label: string;
  kind: string;
  free: string;
  total: string;
  status: string;
  low: boolean;
  detail: string;
};

export type Finding = {
  job: string;
  guest: string;
  result: string;
  heading: string;
  transcript: string;
  hidden_lines: number;
};

export type Upgrade = {
  name: string;
  current: string;
  candidate: string;
  security: boolean;
};

export type Packages = {
  checked: boolean;
  total: number | null;
  security: number | null;
  pending: number | null;
  names: string[];
  upgrades: Upgrade[];
  error: string;
};

export type GuestUpdateRow = {
  id: string;
  packages: number;
  security: number;
  compose: string[];
  floating: boolean;
  error: string;
};

export type GuestUpdates = {
  checked: boolean;
  error: string;
  rows: GuestUpdateRow[];
  active: string;
};

export type ViewState = {
  refresh_seconds: number;
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
  guest_updates: GuestUpdates;
  panel: {
    version: string;
    latest: string;
    update_available: boolean;
    error: string;
  };
};
