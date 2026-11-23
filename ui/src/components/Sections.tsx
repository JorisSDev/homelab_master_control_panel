import { useState } from "react";
import { FadeText } from "./FadeText";
import { RunDisclosure, Runs } from "./Runs";
import type { JobView, Packages, Section, Upgrade, ViewState } from "../types";

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
      <UpdateActions job={job} onChecked={onChecked} />
      <p className="quiet">Next run {job.next}</p>
      <LiveJob job={job} />
      <PackageTable packages={packages} />
      <Runs title="Past runs" runs={job.history} />
    </section>
  );
}

export function ScanJob({ job }: { job: JobView }) {
  return (
    <section>
      <h2>Scan</h2>
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
      <Timeline job={job} />
      {job.waiting ? <p>The job has started. The first check will appear here.</p> : null}
      {job.lock ? <p className="quiet">{job.lock}</p> : null}
      <ScanAction idle={job.idle && !job.lock} />
      <Runs title="Past runs" runs={job.history} />
    </section>
  );
}

function LiveJob({ job }: { job: JobView }) {
  if (job.idle && !job.lock) {
    return null;
  }
  return (
    <>
      <div className="status-row">
        <p className={job.idle ? "status" : "status live"}>
          <FadeText text={job.status} />
        </p>
        {!job.idle && job.elapsed ? <p className="elapsed">{job.elapsed}</p> : null}
      </div>
      {!job.idle && job.detail ? (
        <p className="detail">
          <FadeText text={job.detail} />
        </p>
      ) : null}
      {!job.idle && job.started ? <p className="quiet">Started {job.started}</p> : null}
      <Timeline job={job} />
      {job.waiting ? <p>The job has started. The first check will appear here.</p> : null}
      {job.lock ? <p className="quiet">{job.lock}</p> : null}
    </>
  );
}

function Timeline({ job }: { job: JobView }) {
  if (job.timeline.length === 0) {
    return null;
  }
  return (
    <ol className="timeline">
      {job.timeline.map((item, index) => (
        <li key={`${item.text}-${index}`} className={item.current ? "step-current" : undefined} aria-current={item.current ? "step" : undefined}>
          <span>{item.text}</span>
          {item.current ? <span className="badge">Now</span> : null}
        </li>
      ))}
    </ol>
  );
}

function ScanAction({ idle }: { idle: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/actions/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || "The job did not start.");
        return;
      }
      setMessage("Starting the scan.");
    } catch {
      setMessage("The page could not start the job.");
    } finally {
      setBusy(false);
    }
  }

  if (!idle) {
    return message ? <p className="quiet">{message}</p> : null;
  }

  return (
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void start()}>
        Run the scan
      </button>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
    </div>
  );
}

function UpdateActions({ job, onChecked }: { job: JobView; onChecked: (packages: Packages) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canUpdate = job.idle && !job.lock;

  async function post(path: string, body?: Record<string, boolean>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json().catch(() => ({}))) as Packages & { error?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || (path.endsWith("/check") ? "The package check did not finish." : "The job did not start."));
        return;
      }
      if (path.endsWith("/check")) {
        onChecked(payload);
        return;
      }
      setConfirming(false);
      setMessage("Starting the update.");
    } catch {
      setMessage(path.endsWith("/check") ? "The page could not check packages." : "The page could not start the job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="update-bar">
      <div className="actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void post("/api/packages/check")}>
          Check for updates
        </button>
        {canUpdate && !confirming ? (
          <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
            Update all
          </button>
        ) : null}
        {canUpdate && confirming ? (
          <>
            <button type="button" disabled={busy} onClick={() => void post("/api/actions/update", { confirm: true })}>
              Start the update
            </button>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : null}
      </div>
      {confirming ? <p>This installs packages, recreates the Compose apps, and restarts playback.</p> : null}
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
          <RunDisclosure
            key={`${item.job}-${item.heading}`}
            heading={item.job === "scan" ? "Scan" : "Update"}
            result={item.result}
            ok={false}
            transcript={item.transcript}
            hiddenLines={item.hidden_lines}
            note={item.guest === "host" ? "On the host" : item.guest ? `Guest ${item.guest}` : "Guest not named"}
          />
        ))
      )}
    </section>
  );
}

export function Containers({ services }: { services: ViewState["services"] }) {
  return (
    <section>
      <h2>Containers</h2>
      <p className="lede">{services.purpose}</p>
      <p className="status">{services.status}</p>
      <p className="detail">{services.summary}</p>
      {services.rows.length === 0 ? (
        <p className="quiet">No guests are configured.</p>
      ) : (
        <table className="stack">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Services</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Disk</th>
            </tr>
          </thead>
          <tbody>
            {services.rows.map((row) => (
              <tr key={row.id}>
                <td className="num" data-label="ID">
                  {row.kind === "vm" ? "VM" : "CT"} {row.id}
                </td>
                <td className="name" data-label="Name">
                  {row.url ? (
                    <a href={row.url} target="_blank" rel="noopener noreferrer">
                      {row.name}
                    </a>
                  ) : (
                    <span className="unit">{row.name}</span>
                  )}
                  <span className="note">
                    <span className={row.status === "Stopped" ? "bad" : undefined}>{row.status}</span>
                  </span>
                </td>
                <td data-label="Services">{row.services && row.services.length > 0 ? row.services.join(", ") : "—"}</td>
                <td className="num" data-label="CPU">
                  {row.cpu}
                </td>
                <td className="num" data-label="Memory">
                  {row.memory}
                </td>
                <td className="num" data-label="Disk">
                  {row.disk}
                </td>
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
                <td>
                  <span className="unit">{row.label}</span>
                  {row.detail ? <span className="note">{row.detail}</span> : null}
                </td>
                <td className="num">{row.free && row.total ? `${row.free} of ${row.total}` : row.status === "Not mounted" ? "—" : "unknown"}</td>
                <td className={row.low ? "bad" : undefined}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PackageTable({ packages }: { packages: Packages }) {
  const [query, setQuery] = useState("");
  const upgrades = packages.upgrades ?? [];
  if (packages.error) {
    return <p className="bad">{packages.error}</p>;
  }
  if (!packages.checked) {
    return <p className="quiet">Not checked yet.</p>;
  }
  if (upgrades.length === 0) {
    return <p className="quiet">Nothing is waiting.</p>;
  }
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? upgrades.filter((row) => `${row.name} ${row.current} ${row.candidate}`.toLowerCase().includes(needle))
    : upgrades;
  return (
    <div className="package-list">
      {upgrades.length > 8 ? (
        <input
          className="filter"
          type="search"
          aria-label="Filter packages"
          placeholder="Filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="quiet">Nothing matches.</p>
      ) : (
        <table className="stack">
          <thead>
            <tr>
              <th>Package</th>
              <th>Installed</th>
              <th>Candidate</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.name} className={packageTint(row)}>
                <td className="name" data-label="Package">
                  {row.name}
                </td>
                <td className="num" data-label="Installed">
                  {row.current}
                </td>
                <td className="num" data-label="Candidate">
                  {row.candidate}
                </td>
                <td data-label="Type">{row.security ? "Security" : "Other"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function packageTint(row: Upgrade) {
  if (row.security) {
    return "row-security";
  }
  if (row.candidate) {
    return "row-candidate";
  }
  return undefined;
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
