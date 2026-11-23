export type Job = {
  label: string;
  since: string;
  started: string;
  elapsed: string;
};

export type Step = {
  step: string;
  guest: string;
};

export type TimelineStep = {
  text: string;
  current: boolean;
  guest: string;
  step: string;
  elapsed: string;
};

export type Now = {
  idle: boolean;
  status: string;
  detail: string;
  text: string;
  jobs: Job[];
  step: Step | null;
  timeline: TimelineStep[];
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
};
