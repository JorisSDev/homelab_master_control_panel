import { Disclosure } from "./Disclosure";
import type { Run } from "../types";

export function Runs({ title, runs }: { title: string; runs: Run[] }) {
  return (
    <>
      <h3>{title}</h3>
      {runs.length === 0 ? (
        <p className="quiet">No report yet.</p>
      ) : (
        runs.map((run) => (
          <article key={run.heading} className="run">
            <p className="run-line">
              <strong>{run.heading}</strong>
              <span className={run.ok ? "ok" : "bad"}>{run.result}</span>
            </p>
            <Disclosure summary="Transcript">
              {run.steps.length > 0 ? (
                <ul>
                  {run.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : null}
              <pre>{run.transcript}</pre>
              {run.hidden_lines > 0 ? (
                <p className="quiet">{run.hidden_lines} more lines are in the log file.</p>
              ) : null}
            </Disclosure>
          </article>
        ))
      )}
    </>
  );
}
