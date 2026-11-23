import { useState } from "react";
import { Disclosure } from "./Disclosure";
import { FadeText } from "./FadeText";
import { Runs } from "./Runs";
import type { JobView, Packages, Section, ViewState } from "../types";

export function Home({ state, onOpen }: { state: ViewState; onOpen: (section: Section) => void }) {
  return (
    <section>
      <h2>Home</h2>
      <div className="cards">
        {state.home.cards.map((card) => (
          <button key={card.id} type="button" className="card" onClick={() => onOpen(card.id)}>
            <strong>{card.title}</strong>
            <span className="status">
              <FadeText text={card.status} />
            </span>
            <span className="quiet">{card.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function UpdateJob({ job, packages, onChecked }: { job: JobView; packages: Packages; onChecked: (packages: Packages) => void }) {
  return (
    <section>
      <h2>Update</h2>
      <JobBody job={job} action="update" />
      <PackageCheck packages={packages} onChecked={onChecked} />
    </section>
  );
}

export function ScanJob({ job }: { job: JobView }) {
  return (
    <section>
      <h2>Scan</h2>
      <JobBody job={job} action="scan" />
    </section>
  );
}

function JobBody({ job, action }: { job: JobView; action: "scan" | "update" }) {
  return (
    <>
      <p className="lede">{job.purpose}</p>
      <div className="status-row">
        <p className={job.idle ? "status" : "status live"}>
          <FadeText text={job.status} />
        </p>
        {job.elapsed ? <p className="elapsed">{job.elapsed}</p> : null}
      </div>
      <p className="detail">
        <FadeText text={job.detail} />
      </p>
      <p className="quiet">Next run {job.next}</p>
      {job.started ? <p className="quiet">Started {job.started}</p> : null}
      {action === "update" && job.security != null ? (
        <p>
          {job.dry ? "The last report was a dry run. " : "The last report was a real run. "}
          {job.security} Debian security packages
          {job.pending != null ? `, and ${job.pending} other host packages stayed pending.` : "."}
        </p>
      ) : null}
      {job.timeline.length > 0 ? (
        <ol className="timeline">
          {job.timeline.map((item, index) => (
            <li key={`${item.text}-${index}`} className={item.current ? "step-current" : undefined} aria-current={item.current ? "step" : undefined}>
              <span>{item.text}</span>
              {item.current ? <span className="badge">Now</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {job.waiting ? <p>The job has started. The first check will appear here.</p> : null}
      {job.lock ? <p className="quiet">{job.lock}</p> : null}
      <JobAction action={action} idle={job.idle && !job.lock} />
      <Runs title="Past runs" runs={job.history} />
    </>
  );
}

function JobAction({ action, idle }: { action: "scan" | "update"; idle: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function post(path: string, body: Record<string, boolean>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; started?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || "The job did not start.");
        return;
      }
      setConfirming(false);
      setMessage(payload.started === "update" ? "Starting the update." : "Starting the scan.");
    } catch {
      setMessage("The page could not start the job.");
    } finally {
      setBusy(false);
    }
  }

  if (!idle) {
    return message ? <p className="quiet">{message}</p> : null;
  }

  if (action === "update" && confirming) {
    return (
      <div className="confirm">
        <p>This installs packages, recreates the Compose apps, and restarts playback.</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void post("/api/actions/update", { confirm: true })}>
            Start the update
          </button>
          <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
        {message ? <p className="bad">{message}</p> : null}
      </div>
    );
  }

  if (action === "scan") {
    return (
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void post("/api/actions/scan", {})}>
          Run the scan
        </button>
        {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="actions">
      <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirming(true)}>
        Run the update
      </button>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
    </div>
  );
}

export function Findings({ findings }: { findings: ViewState["findings"] }) {
  return (
    <section>
      <h2>Findings</h2>
      <p className="lede">{findings.purpose}</p>
      <p className="status">{findings.status}</p>
      <p className="detail">{findings.summary}</p>
      {findings.items.length === 0 ? (
        <p className="quiet">Nothing needs attention.</p>
      ) : (
        findings.items.map((item) => (
          <article key={`${item.job}-${item.heading}`} className="run">
            <p className="run-line">
              <strong>{item.job === "scan" ? "Scan" : "Update"}</strong>
              <span className="bad">{item.result}</span>
            </p>
            <p className="quiet">{item.guest === "host" ? "On the host" : item.guest ? `Guest ${item.guest}` : "Guest not named"}</p>
            <Disclosure summary="Transcript">
              <pre>{item.transcript}</pre>
              {item.hidden_lines > 0 ? <p className="quiet">{item.hidden_lines} more lines are in the log file.</p> : null}
            </Disclosure>
          </article>
        ))
      )}
    </section>
  );
}

export function Services({ services }: { services: ViewState["services"] }) {
  return (
    <section>
      <h2>Services</h2>
      <p className="lede">{services.purpose}</p>
      <p className="status">{services.status}</p>
      <p className="detail">{services.summary}</p>
      {services.rows.length === 0 ? (
        <p className="quiet">No guests are configured.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Guest</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {services.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="unit">{row.name}</span>
                  <span className="note">{row.kind === "vm" ? "Virtual machine" : "Container"}</span>
                </td>
                <td className={row.status === "Stopped" ? "bad" : undefined}>{row.status}</td>
                <td>{row.url ? <a className="open" href={row.url} target="_blank" rel="noopener noreferrer">Open</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Storage({ storage }: { storage: ViewState["storage"] }) {
  return (
    <section>
      <h2>Storage</h2>
      <p className="lede">{storage.purpose}</p>
      <p className="status">{storage.status}</p>
      <p className="detail">{storage.summary}</p>
      {storage.rows.length === 0 ? (
        <p className="quiet">This copy cannot read the disks.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Where</th>
              <th>Free</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {storage.rows.map((row) => (
              <tr key={`${row.kind}-${row.label}`}>
                <td className="unit">{row.label}</td>
                <td>{row.free && row.total ? `${row.free} of ${row.total}` : "unknown"}</td>
                <td className={row.low || row.status === "Unavailable" ? "bad" : undefined}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PackageCheck({ packages, onChecked }: { packages: Packages; onChecked: (packages: Packages) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/packages/check", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as Packages & { error?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || "The package check did not finish.");
        return;
      }
      onChecked(payload);
    } catch {
      setMessage("The page could not check packages.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm">
      <p>Asks what apt would upgrade. It does not install anything. Sunday still does the install.</p>
      {packages.checked ? (
        <p>
          {packages.total ? `${packages.security ?? 0} security, ${packages.pending ?? 0} other.` : "Nothing is waiting."}
        </p>
      ) : (
        <p className="quiet">Not checked yet.</p>
      )}
      {packages.names.length > 0 ? (
        <ul>
          {packages.names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
      {packages.error ? <p className="bad">{packages.error}</p> : null}
      <div className="actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void check()}>
          Check pending packages
        </button>
      </div>
      {message ? <p className="bad">{message}</p> : null}
    </div>
  );
}

export function Health({ health }: { health: ViewState["health"] }) {
  return (
    <section>
      <h2>Health</h2>
      <p className="lede">{health.purpose}</p>
      <p className="status">{health.status}</p>
      <p className="detail">{health.summary}</p>
      {health.load || health.memory_total || health.disk_total ? (
        <dl className="metrics">
          <div>
            <dt>Load</dt>
            <dd>{health.load || "unknown"}</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>{health.memory_used && health.memory_total ? `${health.memory_used} of ${health.memory_total}` : "unknown"}</dd>
          </div>
          <div>
            <dt>Free on /</dt>
            <dd>{health.disk_free && health.disk_total ? `${health.disk_free} of ${health.disk_total}` : "unknown"}</dd>
          </div>
        </dl>
      ) : null}
      <p className="quiet">
        Disk check next {health.disk_check.next}. Last {health.disk_check.last}.
      </p>
      <Disclosure summary="Other host timers">
        {health.housekeeping.length === 0 ? (
          <p className="quiet">No other timers.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Timer</th>
                <th>Next</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {health.housekeeping.map((row) => (
                <tr key={row.unit}>
                  <td>
                    <span className="unit">{row.unit}</span>
                    {row.note ? <span className="note">{row.note}</span> : null}
                  </td>
                  <td>{row.next}</td>
                  <td>{row.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Disclosure>
    </section>
  );
}

export function PanelPage({ panel, onSignOut }: { panel: ViewState["panel"]; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function install() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/panel/update", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || "The release was not installed.");
        return;
      }
      setMessage(
        payload.status === "current"
          ? "This is already the latest release."
          : "Installing the new release. Sign in again in a moment.",
      );
    } catch {
      setMessage("The page could not reach the installer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Panel</h2>
      <p className="lede">This copy of the panel, and the latest published release.</p>
      <dl className="metrics">
        <div>
          <dt>Installed</dt>
          <dd>{panel.version}</dd>
        </div>
        <div>
          <dt>Latest release</dt>
          <dd>{panel.latest || "Not checked"}</dd>
        </div>
      </dl>
      {panel.error ? <p className="quiet">{panel.error}</p> : null}
      <div className="actions">
        {panel.update_available ? (
          <button type="button" disabled={busy} onClick={() => void install()}>
            Install
          </button>
        ) : null}
        <button type="button" className="quiet-button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      {message ? <p className={message.startsWith("Installing") || message.startsWith("This is") ? "ok" : "bad"}>{message}</p> : null}
    </section>
  );
}
