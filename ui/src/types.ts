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
  address?: string;
  order?: number | null;
  onboot?: boolean;
  up?: number | null;
  role?: string;
  mounts?: string[];
  nameservers?: string[];
  blast?: string[];
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
  reboot?: boolean;
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
  attention?: AttentionItem[];
  figures?: Figures;
  week?: WeekItem[];
  upcoming?: WeekItem[];
  calendar?: CalendarState;
  schedule?: ScheduleState;
  reach?: ReachState;
  das?: DasState;
  protection?: ProtectionState;
  scan_meaning?: ScanMeaning;
  plex?: PlexState;
  chronology?: ChronologyItem[];
  recovery?: RecoveryItem[];
  operator?: { text: string }[];
  uptime_seconds?: number | null;
};

export type AttentionItem = { severity: string; text: string; href: string };

export type Figures = {
  load: string;
  memory_used: string;
  memory_total: string;
  memory_assigned: string;
  root_free: string;
  root_total: string;
  das_free: string;
  das_total: string;
  das_label: string;
};

export type WeekItem = { unit: string; label: string; next: string; soon: boolean };

export type CalendarRule = { label: string; time: string; weekdays: number[] | null; until?: string };

export type CalendarState = { rules: CalendarRule[]; standing: string[] };

export type ScheduleState = {
  skip: string;
  once: string;
  once_time: string;
  weekly: { weekday: number; time: string } | null;
};

export type ReachPath = {
  name: string;
  guest: string;
  lan: string;
  public: string;
  lan_ok: boolean | null;
  public_ok: boolean | null;
  kuma: string;
};

export type MonitorRow = {
  name: string;
  type: string;
  status: string;
  at: string;
  uptime_24h?: number | null;
  uptime_7d?: number | null;
  last_down?: string;
};

export type ReachState = {
  paths: ReachPath[];
  kuma_url?: string;
  monitors: { ok: boolean; error: string; summary: string; rows: MonitorRow[] };
  pins: { checked: boolean; summary: string; rows: { id: string; name: string; ok: boolean }[] };
  multicast_snooping: boolean | null;
  tunnel: { guest: string; connections: number | null; detail: string };
  wan: { port: string | number; guest: string; listening: boolean | null };
};

export type DasState = {
  expected_uuid: string;
  mounted_uuid: string;
  speeds: string[];
  faults: number;
  recent: string[];
  smart: string;
  fstab_waits: boolean | null;
  summary: string;
  match: string;
};

export type ProtectionState = {
  has_job: boolean;
  rows: { name: string; id: string; backup: string; snapshot: string; copy: string }[];
};

export type ScanMeaning = {
  coverage: string[];
  signature: string;
  signature_days: number | null;
  streaks: { text: string; count: number }[];
};

export type PlexState = {
  id: string;
  version: string;
  claimed: string;
  minimum: string;
  ok: boolean;
  render: string;
};

export type ChronologyItem = { text: string; href: string };

export type RecoveryItem = { id: string; label: string; ok: boolean | null; detail: string };

export type Digest = {
  scan: string;
  update: string;
  guests: string;
  monitors: string;
  disk: string;
  event: string;
};
