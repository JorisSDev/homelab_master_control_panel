import { HardDrive } from "lucide-react";
import { useState } from "react";
import { Badge, Disclosure, Empty, Meter, Notice, Page, Panel } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Table, TableCell, TableHead } from "../components/ui/table";
import { postJson } from "../lib";
import type { ViewState } from "../types";

export function Storage({ state }: { state: ViewState }) {
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const das = state.das;
  const protection = state.protection;

  async function runDisk() {
    setBusy(true);
    setMessage(null);
    const result = await postJson("/api/actions/disk");
    setBusy(false);
    setMessage({ ok: result.ok, text: result.ok ? "Starting the disk check." : String(result.data.error || "The disk check did not start.") });
  }

  return (
    <Page title="Storage" context={state.storage.summary} action={(
      <Button type="button" variant="outline" disabled={busy} onClick={() => void runDisk()}>
        <HardDrive aria-hidden="true" />{busy ? "Starting disk check…" : "Run disk check"}
      </Button>
    )}>
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      <Panel title="Capacity">
        {state.storage.rows.length ? (
          <ul className="capacity-list">
            {state.storage.rows.map((row) => (
              <li key={`${row.kind}-${row.label}`}>
                <HardDrive aria-hidden="true" />
                <div><Meter label={storageName(row.label, state.figures?.das_label)} used={row.used} free={row.free} total={row.total} low={row.low} />
                  {row.detail ? <p className="note">{row.detail}</p> : null}</div>
                {row.status ? <Badge value={row.low ? "Low" : row.status} /> : null}
              </li>
            ))}
          </ul>
        ) : <Empty>No storage readings are available.</Empty>}
      </Panel>
      <Panel title="External storage" action={das?.match ? <Badge value={das.match} /> : undefined}>
        <p>{das?.summary || "The disk shelf has not been read."}</p>
        {das ? (
          <>
            <dl className="fact-list">
              {das.speeds?.length ? <div><dt>Link speeds</dt><dd>{das.speeds.join(", ")}</dd></div> : null}
              {das.faults ? <div><dt>Bus errors</dt><dd className="num">{das.faults}</dd></div> : null}
              {das.fstab_waits != null ? <div><dt>Mount at startup</dt><dd>{das.fstab_waits ? "fstab waits for the disk." : "fstab does not wait for the disk."}</dd></div> : null}
              {das.smart ? <div><dt>Monitor</dt><dd><Badge value={das.smart} /></dd></div> : null}
            </dl>
            {das.expected_uuid || das.mounted_uuid || das.recent.length ? (
              <Disclosure label="Mount details and recent events">
                <dl className="fact-list">
                  {das.expected_uuid ? <div><dt>Expected UUID</dt><dd className="technical">{das.expected_uuid}</dd></div> : null}
                  {das.mounted_uuid ? <div><dt>Mounted UUID</dt><dd className="technical">{das.mounted_uuid}</dd></div> : null}
                </dl>
                {das.recent.length ? <ul className="activity-list">{das.recent.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : null}
              </Disclosure>
            ) : null}
          </>
        ) : null}
      </Panel>
      <Panel title="Protection">
        {protection?.has_job === false ? <Notice tone="warning" message="No backup schedule was detected." /> : null}
        {protection?.rows.length ? (
          <>
            <div className="table-scroll visual-desktop">
              <Table aria-label="Storage protection">
                <thead><tr><TableHead>Where</TableHead><TableHead>Backup</TableHead><TableHead>Snapshot</TableHead><TableHead>Copy</TableHead></tr></thead>
                <tbody>
                  {protection.rows.map((row) => (
                    <tr key={`${row.id}-${row.name}`}><TableCell>{row.name}</TableCell><TableCell>{row.backup}</TableCell><TableCell>{row.snapshot}</TableCell><TableCell>{row.copy || "—"}</TableCell></tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="visual-mobile"><div className="table-stack">
              {protection.rows.map((row) => (
                <Disclosure key={`${row.id}-${row.name}`} label={<span className="record-summary"><strong>{row.name}</strong><Badge value={row.backup} /></span>}>
                  <dl className="fact-list"><div><dt>Snapshot</dt><dd>{row.snapshot}</dd></div><div><dt>Copy</dt><dd>{row.copy || "—"}</dd></div></dl>
                </Disclosure>
              ))}
            </div></div>
          </>
        ) : <Empty>No protection records are available.</Empty>}
      </Panel>
    </Page>
  );
}

function storageName(label: string, shelf: string | undefined) {
  if (label === "/") return "Internal";
  if (shelf && label === shelf) return "External";
  return label;
}
