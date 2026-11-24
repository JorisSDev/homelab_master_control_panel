import { useState } from "react";
import { Meter, Page } from "../components/Chrome";
import { postJson } from "../lib";
import type { ProtectionState, ViewState } from "../types";

export function Storage({ state }: { state: ViewState }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const das = state.das;
  const protection = state.protection;

  async function runDisk() {
    setBusy(true);
    setMessage("");
    const result = await postJson("/api/actions/disk");
    setBusy(false);
    setMessage(result.ok ? "Starting the disk check." : String(result.data.error || "The disk check did not start."));
  }

  return (
    <Page
      title="Storage"
      context={state.storage.summary}
      action={
        <button type="button" disabled={busy} onClick={() => void runDisk()}>
          Run disk check
        </button>
      }
    >
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <div className="meters">
        {state.storage.rows.map((row) => (
          <Meter key={`${row.kind}-${row.label}`} label={row.label} free={row.free} total={row.total} low={row.low} />
        ))}
      </div>
      <article className="dossier">
        <p className="section-label">Disk shelf</p>
        <p>{das?.summary || "The disk shelf has not been read."}</p>
        {das?.speeds?.length ? <p>{das.speeds.join(", ")}</p> : null}
        {das?.faults ? <p>{das.faults} bus errors.</p> : null}
        {das?.fstab_waits === true ? <p>fstab waits for the disk.</p> : null}
        {das?.fstab_waits === false ? <p>fstab does not wait for the disk.</p> : null}
        {das?.smart ? <p>Monitor {das.smart}</p> : null}
        {das?.expected_uuid ? <p className="quiet">Expected {das.expected_uuid}</p> : null}
        {das?.mounted_uuid ? <p className="quiet">Mounted {das.mounted_uuid}</p> : null}
        {das && das.recent.length > 0 ? (
          <ul>
            {das.recent.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </article>
      <p className="section-label">Protection</p>
      {hasProtection(protection) ? (
        <>
          <table>
            <thead>
              <tr>
                <th>Where</th>
                <th>Backup</th>
                <th>Snapshot</th>
                <th>Copy</th>
              </tr>
            </thead>
            <tbody>
              {(protection?.rows || []).map((row) => (
                <tr key={`${row.id}-${row.name}`}>
                  <td>{row.name}</td>
                  <td>{row.backup}</td>
                  <td>{row.snapshot}</td>
                  <td>{row.copy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {protection?.has_job ? null : <p>There is no backup job.</p>}
        </>
      ) : (
        <p>Nothing is backed up. There is no backup job, and no machine has a second copy.</p>
      )}
    </Page>
  );
}

function hasProtection(protection: ProtectionState | undefined) {
  if (!protection) {
    return false;
  }
  if (protection.has_job) {
    return true;
  }
  return protection.rows.some((row) => (row.backup && row.backup !== "No job") || Boolean(row.copy));
}
