import { useState } from "react";
import { FadeText } from "./FadeText";
import { RunDisclosure, Runs } from "./Runs";
import type { GuestUpdateRow, GuestUpdates, JobView, Packages, Section, ServiceRow, Upgrade, ViewState } from "../types";

export function Home({ state, onOpen }: { state: ViewState; onOpen: (section: Section) => void }) {
  const running = state.services.rows.filter((row) => row.status === "Running");
  const stopped = state.services.rows.filter((row) => row.status === "Stopped").length;
  return (
    <section>
      <FindingsList findings={state.findings} />
      <div className="status-line">
        <button type="button" className="quiet-button" onClick={() => onOpen("scan")}>
          Scan {state.scan.next}
        </button>
        <button type="button" className="quiet-button" onClick={() => onOpen("update")}>
          Update {state.update.next}
        </button>
        <button type="button" className="quiet-button" onClick={() => onOpen("storage")}>
          Storage {state.storage.summary}
        </button>
        <button type="button" className="quiet-button" onClick={() => onOpen("panel")}>
          Panel {state.panel.version}
        </button>
      </div>
      {running.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Guest</th>
              <th>Services</th>
              <th>CPU</th>
              <th>Memory</th>
            </tr>
          </thead>
          <tbody>
            {running.map((row) => (
              <tr key={row.id}>
                <td data-label="Guest">
                  <span className="unit">
                    {row.kind === "vm" ? "VM" : "CT"} {row.id}
                  </span>
                  <GuestName name={row.name} url={row.url} />
                </td>
                <td data-label="Services">{joined(row.services)}</td>
                <td className="num" data-label="CPU">
                  {row.cpu}
                </td>
                <td className="num" data-label="Memory">
                  {row.memory}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {stopped > 0 ? (
        <div className="status-line">
          <button type="button" className="quiet-button" onClick={() => onOpen("services")}>
            {stopped} stopped
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function UpdateJob({
  job,
  packages,
  services,
  guestUpdates,
  onPackages,
  onGuests,
  onGuestActive,
}: {
  job: JobView;
  packages: Packages;
  services: ViewState["services"];
  guestUpdates: GuestUpdates;
  onPackages: (packages: Packages) => void;
  onGuests: (guestUpdates: GuestUpdates) => void;
  onGuestActive: (id: string) => void;
}) {
  return (
    <section>
      <h2>Update</h2>
      <UpdateActions job={job} onPackages={onPackages} onGuests={onGuests} />
      <p className="quiet">Next run {job.next}</p>
      <LiveJob job={job} />
      <GuestUpdateTable services={services} guestUpdates={guestUpdates} onGuestActive={onGuestActive} />
      <details className="disclosure">
        <summary>Host packages</summary>
        <PackageTable packages={packages} />
      </details>
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

function UpdateActions({
  job,
  onPackages,
  onGuests,
}: {
  job: JobView;
  onPackages: (packages: Packages) => void;
  onGuests: (guestUpdates: GuestUpdates) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canUpdate = job.idle && !job.lock;

  async function check() {
    setBusy(true);
    setMessage("");
    try {
      const [packagesResponse, guestsResponse] = await Promise.all([
        fetch("/api/packages/check", { method: "POST" }),
        fetch("/api/guests/check", { method: "POST" }),
      ]);
      if (packagesResponse.status === 401 || guestsResponse.status === 401) {
        window.location.reload();
        return;
      }
      const packagesPayload = (await packagesResponse.json().catch(() => ({}))) as Packages & { error?: string };
      const guestsPayload = (await guestsResponse.json().catch(() => ({}))) as GuestUpdates & { error?: string };
      if (packagesResponse.ok) {
        onPackages(packagesPayload);
      }
      if (guestsResponse.ok) {
        onGuests(guestsPayload);
      }
      if (!packagesResponse.ok) {
        setMessage(packagesPayload.error || "The package check did not finish.");
      } else if (!guestsResponse.ok) {
        setMessage(guestsPayload.error || "The guest check did not finish.");
      }
    } catch {
      setMessage("The page could not check packages.");
    } finally {
      setBusy(false);
    }
  }

  async function startAll() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/actions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
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
      setConfirming(false);
      setMessage("Starting the update.");
    } catch {
      setMessage("The page could not start the job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="update-bar">
      <div className="actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void check()}>
          Check for updates
        </button>
        {canUpdate && !confirming ? (
          <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
            Update all
          </button>
        ) : null}
        {canUpdate && confirming ? (
          <>
            <button type="button" disabled={busy} onClick={() => void startAll()}>
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

function FindingsList({ findings }: { findings: ViewState["findings"] }) {
  if (findings.count === 0) {
    return <p className="quiet">Nothing needs attention.</p>;
  }
  return (
    <>
      {findings.items.map((item) => (
        <RunDisclosure
          key={`${item.job}-${item.heading}`}
          heading={item.job === "scan" ? "Scan" : "Update"}
          result={item.result}
          ok={false}
          transcript={item.transcript}
          hiddenLines={item.hidden_lines}
          note={item.guest === "host" ? "On the host" : item.guest ? `Guest ${item.guest}` : "Guest not named"}
        />
      ))}
    </>
  );
}

export function Containers({ services }: { services: ViewState["services"] }) {
  const [query, setQuery] = useState("");
  const ordered = [...services.rows].sort((left, right) => guestRank(left.status) - guestRank(right.status));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? ordered.filter((row) => `${row.name} ${row.id} ${row.services.join(" ")}`.toLowerCase().includes(needle))
    : ordered;
  return (
    <section>
      <h2>Containers</h2>
      <p className="lede">{services.purpose}</p>
      <p className="status">{services.status}</p>
      <p className="detail">{services.summary}</p>
      {services.rows.length === 0 ? (
        <p className="quiet">No guests are configured.</p>
      ) : (
        <>
          <input
            className="filter"
            type="search"
            aria-label="Filter"
            placeholder="Filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {shown.length === 0 ? (
            <p className="quiet">Nothing matches.</p>
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
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td className="num" data-label="ID">
                      {row.kind === "vm" ? "VM" : "CT"} {row.id}
                    </td>
                    <td className="name" data-label="Name">
                      <GuestName name={row.name} url={row.url} />
                      <span className="note">
                        <span className={row.status === "Stopped" ? "bad" : undefined}>{row.status}</span>
                      </span>
                    </td>
                    <td data-label="Services">{joined(row.services)}</td>
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
        </>
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

function GuestName({ name, url }: { name: string; url: string }) {
  if (!url) {
    return <span className="unit">{name}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {name}
    </a>
  );
}

function joined(services: string[]) {
  return services.length > 0 ? services.join(", ") : "—";
}

function guestRank(status: string) {
  return status === "Running" ? 0 : 1;
}

function GuestUpdateTable({
  services,
  guestUpdates,
  onGuestActive,
}: {
  services: ViewState["services"];
  guestUpdates: GuestUpdates;
  onGuestActive: (id: string) => void;
}) {
  const byId = new Map(guestUpdates.rows.map((row) => [row.id, row]));
  if (services.rows.length === 0) {
    return <p className="quiet">No guests are configured.</p>;
  }
  return (
    <table className="stack">
      <thead>
        <tr>
          <th>Guest</th>
          <th>Running</th>
          <th>Waiting</th>
          <th>Update</th>
        </tr>
      </thead>
      <tbody>
        {services.rows.map((row) => {
          const update = byId.get(row.id);
          const active = guestUpdates.active === row.id;
          return (
            <tr key={row.id} className={guestTint(update)}>
              <td className="name" data-label="Guest">
                <span className="unit">
                  {row.kind === "vm" ? "VM" : "CT"} {row.id}
                </span>
                {active ? <span className="unit">{row.name} is updating</span> : <GuestName name={row.name} url={row.url} />}
              </td>
              <td data-label="Running">{joined(row.services)}</td>
              <td className={update?.error ? "bad" : undefined} data-label="Waiting">
                {waitingText(guestUpdates.checked, update)}
              </td>
              <td data-label="Update">
                <GuestUpdate row={row} active={active} onActive={onGuestActive} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function waitingText(checked: boolean, row: GuestUpdateRow | undefined) {
  if (!checked) {
    return "Not checked yet";
  }
  if (!row) {
    return "—";
  }
  if (row.error) {
    return row.error;
  }
  return String(row.packages);
}

function guestTint(row: GuestUpdateRow | undefined) {
  if (!row || !(row.packages > 0 || row.floating)) {
    return undefined;
  }
  if (row.security > 0) {
    return "row-security";
  }
  return "row-candidate";
}

function GuestUpdate({ row, active, onActive }: { row: ServiceRow; active: boolean; onActive: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (row.kind === "vm" || active) {
    return null;
  }

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/guests/${row.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setMessage(payload.error || "The update did not start.");
        return;
      }
      setConfirming(false);
      onActive(row.id);
    } catch {
      setMessage("The page could not start the update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-actions">
      {!confirming ? (
        <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
          Update
        </button>
      ) : (
        <>
          <p>This upgrades {row.name} and restarts what is running in it.</p>
          <button type="button" disabled={busy} onClick={() => void start()}>
            Start the update
          </button>
          <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      )}
      {message ? <p className="bad">{message}</p> : null}
    </div>
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
