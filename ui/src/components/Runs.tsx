import type { Run } from "../types";

export function Runs({ title, runs }: { title: string; runs: Run[] }) {
  return (
    <>
      <h3>{title}</h3>
      {runs.length === 0 ? (
        <p className="quiet">No report yet.</p>
      ) : (
        runs.map((run) => (
          <RunDisclosure
            key={run.heading}
            heading={run.heading}
            result={run.result}
            ok={run.ok}
            steps={run.steps}
            transcript={run.transcript}
            hiddenLines={run.hidden_lines}
          />
        ))
      )}
    </>
  );
}

export function RunDisclosure({
  heading,
  result,
  ok,
  steps = [],
  transcript = "",
  hiddenLines = 0,
  note = "",
}: {
  heading: string;
  result: string;
  ok: boolean;
  steps?: string[];
  transcript?: string;
  hiddenLines?: number;
  note?: string;
}) {
  return (
    <details className="run">
      <summary>
        <span className="run-line">
          <strong>{heading}</strong>
          <span className={ok ? "ok" : "bad"}>{result}</span>
        </span>
      </summary>
      {note ? <p className="quiet">{note}</p> : null}
      {steps.length > 0 ? (
        <ul>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      {transcript ? <pre>{transcript}</pre> : null}
      {hiddenLines > 0 ? <p className="quiet">{hiddenLines} more lines are in the log file.</p> : null}
    </details>
  );
}
