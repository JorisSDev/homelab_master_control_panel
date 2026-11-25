import { useState } from "react";
import { Meter, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Table, TableCell, TableHead } from "../components/ui/table";
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
        <Button type="button" disabled={busy} onClick={() => void runDisk()}>
          Run disk check
        </Button>
      }
    >
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <div className="meters">
        {state.storage.rows.map((row) => (
          <Meter key={`${row.kind}-${row.label}`} label={storageName(row.label, state.figures?.das_label)} free={row.free} total={row.total} low={row.low} />
        ))}
      </div>
      <Card className="figure">
        <p className="section-label">External storage</p>
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
      </Card>
      <p className="section-label">Protection</p>
      {hasProtection(protection) ? (
        <>
          <Table>
            <thead>
              <tr>
                <TableHead>Where</TableHead>
                <TableHead>Backup</TableHead>
                <TableHead>Snapshot</TableHead>
                <TableHead>Copy</TableHead>
              </tr>
            </thead>
            <tbody>
              {(protection?.rows || []).map((row) => (
                <tr key={`${row.id}-${row.name}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.backup}</TableCell>
                  <TableCell>{row.snapshot}</TableCell>
                  <TableCell>{row.copy || "—"}</TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
          {protection?.has_job ? null : <p>There is no backup job.</p>}
        </>
      ) : (
        <p>Nothing is backed up. There is no backup job, and no machine has a second copy.</p>
      )}
    </Page>
  );
}

function storageName(label: string, shelf: string | undefined) {
  if (label === "/") {
    return "Internal";
  }
  if (shelf && label === shelf) {
    return "External";
  }
  return label;
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
