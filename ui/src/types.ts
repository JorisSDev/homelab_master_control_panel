export type Job = {
  label: string;
  since: string;
  elapsed: string;
};

export type Step = {
  step: string;
  guest: string;
};

export type Now = {
  idle: boolean;
  text: string;
  jobs: Job[];
  step: Step | null;
  waiting: boolean;
  lock: string;
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

export type Guest = {
  id: string;
  name: string;
  address: string;
  kind: string;
  last_update: string;
  last_scan: string;
  href: string;
};

export type ViewState = {
  refresh_seconds: number;
  now: Now;
  schedule: {
    featured: TimerRow[];
    housekeeping: TimerRow[];
  };
  history: {
    update: Run[];
    scan: Run[];
  };
  unfinished: {
    facts: string[];
    guests: Guest[];
  };
};
