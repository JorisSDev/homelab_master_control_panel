import { Disclosure } from "./Disclosure";
import type { Run } from "../types";

function Runs({ title, runs }: { title: string; runs: Run[] }) {
  return (
    <>
      <h3>{title}</h3>
      {runs.length === 0 ? (
        <p className="quiet">No {title.toLowerCase()} log yet.</p>
      ) : (
        runs.map((run) => (
          <article key={run.heading}>
            <p>
              <strong>{run.heading}</strong>
              <br />
              <span className={run.ok ? "ok" : "bad"}>{run.result}</span>
            </p>
            {run.steps.length > 0 ? (
              <ul>
                {run.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
            <Disclosure summary="Transcript">
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

export function History({ history }: { history: { update: Run[]; scan: Run[] } }) {
  const empty = history.update.length === 0 && history.scan.length === 0;
  return (
    <section>
      <h2>History</h2>
      <Runs title="Update" runs={history.update} />
      <Runs title="Scan" runs={history.scan} />
      {empty ? <p className="quiet">The timers have not written a log yet.</p> : null}
    </section>
  );
}
