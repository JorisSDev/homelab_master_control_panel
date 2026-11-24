import { useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { postJson } from "../lib";
import type { ViewState } from "../types";

export function Jobs({
  state,
  path,
  onState,
}: {
  state: ViewState;
  path: string;
  onState: (next: ViewState) => void;
}) {
  const scan = path === "/jobs/scan" || path === "/jobs";
  const update = path === "/jobs/update" || path === "/jobs";
  return (
    <Page title="Jobs" context="Scheduled work, and the meaning of the last result.">
      {path === "/jobs" ? <Week state={state} /> : null}
      {scan ? <ScanDossier state={state} /> : null}
      {update ? <UpdateDossier state={state} onState={onState} /> : null}
    </Page>
  );
}

function Week({ state }: { state: ViewState }) {
  const items = state.week || [];
  if (items.length === 0) {
    return <Empty>No timers were read.</Empty>;
  }
  return (
    <ol className="sequence">
      {items.map((item) => (
        <li key={item.unit}>
          <span>{item.label}</span>
          <span className="num">{item.next}</span>
        </li>
      ))}
    </ol>
  );
}

function guestName(state: ViewState, id: string) {
  return state.services.rows.find((row) => row.id === id)?.name || id;
}

function HostPackages({ state }: { state: ViewState }) {
  const packages = state.packages;
  if (!packages.checked) {
    return (
      <p>
        Host packages <span>Not checked.</span>
      </p>
    );
  }
  if (!packages.total) {
    return <p>Nothing is waiting.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Host packages</th>
          <th>Current</th>
          <th>Candidate</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {packages.upgrades.map((row) => (
          <tr key={row.name} className={row.security ? "row-security" : "row-candidate"}>
            <td>{row.name}</td>
            <td className="num">{row.current}</td>
            <td className="num">{row.candidate}</td>
            <td>{row.security ? "Security" : "Other"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScanDossier({ state }: { state: ViewState }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const meaning = state.scan_meaning;
  const plex = state.plex;

  async function run() {
    setBusy(true);
    setMessage("");
    const result = await postJson("/api/actions/scan");
    setBusy(false);
    setMessage(result.ok ? "Starting the scan." : String(result.data.error || "The scan did not start."));
  }

  return (
    <article className="dossier">
      <header className="page-head">
        <div>
          <h2>Scan</h2>
          <p className="quiet">{state.scan.purpose}</p>
        </div>
        <div className="page-action">
          <Badge value={state.scan.status} />
          {state.scan.idle ? (
            <button type="button" disabled={busy} onClick={() => void run()}>
              Run the scan
            </button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <p>
        {state.scan.detail}
        {state.scan.elapsed ? ` · ${state.scan.elapsed}` : ""}
      </p>
      {state.scan.timeline.length > 0 ? (
        <ol className="timeline">
          {state.scan.timeline.map((step) => (
            <li key={step.text} className={step.current ? "step-current" : ""}>
              {step.current ? <span>Now</span> : null}
              {step.text}
            </li>
          ))}
        </ol>
      ) : null}
      {meaning && meaning.coverage.length > 0 ? (
        <ul>
          {meaning.coverage.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {meaning?.signature ? <p>{meaning.signature}</p> : null}
      {plex ? (
        <p>
          Plex {plex.version || "version unknown"}
          {plex.claimed === "1" ? ", claimed" : plex.claimed ? ", not claimed" : ""}. Render device {plex.render}.
        </p>
      ) : null}
      {(meaning?.streaks || []).map((streak) => (
        <p key={streak.text}>
          {streak.text} · {streak.count} times
        </p>
      ))}
    </article>
  );
}

function UpdateDossier({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [dry, setDry] = useState(false);
  const rows = state.guest_updates.rows;

  async function check() {
    setBusy("check");
    setMessage("");
    const host = await postJson("/api/packages/check");
    const guests = await postJson("/api/guests/check");
    setBusy("");
    if (!host.ok || !guests.ok) {
      setMessage(String(guests.data.error || host.data.error || "The check did not finish."));
      return;
    }
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
    setMessage("Checked for updates.");
  }

  async function start(kind: "update" | "dry") {
    setBusy(kind);
    setMessage("");
    const result = await postJson("/api/actions/update", kind === "dry" ? { confirm: true, dry: true } : { confirm: true });
    setBusy("");
    setConfirm(false);
    setDry(false);
    setMessage(result.ok ? "Starting the update." : String(result.data.error || "The update did not start."));
  }

  return (
    <article className="dossier">
      <header className="page-head">
        <div>
          <h2>Sunday update</h2>
          <p className="quiet">Next run {state.update.next}</p>
        </div>
        <div className="page-action">
          <Badge value={state.update.status} />
          <button type="button" className="quiet-button" disabled={busy !== ""} onClick={() => void check()}>
            Check for updates
          </button>
          <button type="button" className="quiet-button" disabled={busy !== ""} onClick={() => setDry(true)}>
            Dry run
          </button>
          {state.update.idle ? (
            <button type="button" disabled={busy !== ""} onClick={() => setConfirm(true)}>
              Update all
            </button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") || message.startsWith("Checked") ? "ok" : "bad"}>{message}</p> : null}
      <p>
        {state.update.detail}
        {state.update.elapsed ? ` · ${state.update.elapsed}` : ""}
      </p>
      {state.guest_updates.active ? <p>{guestName(state, state.guest_updates.active)} is updating</p> : null}
      {(state.update.history[0]?.steps || []).map((step) => (
        <p key={step}>{step}</p>
      ))}
      <HostPackages state={state} />
      {rows.length === 0 ? <Empty>No guest update check has been saved.</Empty> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Guest</th>
              <th>Packages</th>
              <th>Security</th>
              <th>Compose</th>
              <th>Reboot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td className="num">{row.packages}</td>
                <td className="num">{row.security}</td>
                <td>{row.compose.join(", ") || (row.floating ? "floating tag" : "—")}</td>
                <td>{row.reboot ? "wanted" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {confirm ? (
        <Confirm
          title="Start the update"
          confirmLabel="Start the update"
          busy={busy !== ""}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void start("update")}
        >
          <p>This restarts playback, recreates Compose services, and has no vzdump rollback.</p>
        </Confirm>
      ) : null}
      {dry ? (
        <Confirm
          title="Start the dry run"
          confirmLabel="Start the dry run"
          busy={busy !== ""}
          onCancel={() => setDry(false)}
          onConfirm={() => void start("dry")}
        >
          <p>This previews the Sunday update and does not install packages.</p>
        </Confirm>
      ) : null}
    </article>
  );
}
