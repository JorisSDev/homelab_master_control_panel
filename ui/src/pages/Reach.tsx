import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Disclosure, Empty, Notice, Page, Panel } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Table, TableCell, TableHead } from "../components/ui/table";
import { postJson, readSnapshot } from "../lib";
import type { ViewState } from "../types";

export function Reach({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const reach = state.reach;
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  async function run(url: string, label: string) {
    setBusy(url);
    setMessage(null);
    const result = await postJson(url);
    setBusy("");
    setMessage({ ok: result.ok, text: result.ok ? label : String(result.data.error || "The check did not finish.") });
    if (result.ok) {
      const snapshot = await readSnapshot();
      if (snapshot) onState(snapshot);
    }
  }

  const rows = reach?.monitors.rows ?? [];
  const up = rows.filter((row) => row.status === "up").length;
  const down = rows.filter((row) => row.status === "down").length;
  const other = rows.length - up - down;
  const kumaHref = safeHref(reach?.kuma_url);
  const paths = "/api/reach/paths";
  const pins = "/api/reach/pins";

  return (
    <Page title="Reach" context={rows.length ? `${up} up, ${down} down${other ? ` · ${other} in other states` : ""}` : undefined}
      action={kumaHref ? <Button variant="outline" asChild><a href={kumaHref} target="_blank" rel="noopener noreferrer">Open Kuma <ExternalLink aria-hidden="true" /></a></Button> : undefined}>
      <Panel title="Monitors">
        {reach?.monitors.error ? <Notice tone="warning" message={reach.monitors.error} /> : null}
        {rows.length === 0 ? <Empty>{reach?.monitors.ok ? "No monitors were reported." : "No monitor readings are available."}</Empty> : null}
        {reach && rows.length > 0 ? (
          <>
            <p className="meta">Last down covers the past 30 days.</p>
            <div className="table-scroll visual-desktop">
              <Table aria-label="Monitors">
                <thead><tr>
                  <TableHead>Service</TableHead><TableHead>Status</TableHead><TableHead>LAN</TableHead>
                  <TableHead className="num">24h</TableHead><TableHead className="num">7d</TableHead><TableHead className="num">Last down</TableHead>
                </tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.name}-${index}`}>
                    <TableCell><strong>{row.name}</strong></TableCell><TableCell><Badge value={row.status} /></TableCell>
                    <TableCell className="technical">{lanOf(reach.paths, row.name)}</TableCell>
                    <TableCell className="num">{percent(row.uptime_24h)}</TableCell><TableCell className="num">{percent(row.uptime_7d)}</TableCell>
                    <TableCell className="num">{lastDown(row.last_down)}</TableCell>
                  </tr>
                ))}</tbody>
              </Table>
            </div>
            <div className="visual-mobile">
              <div className="table-stack">
                {rows.map((row, index) => (
                  <Disclosure key={`${row.name}-${index}`} label={<span className="record-summary"><strong>{row.name}</strong><Badge value={row.status} /></span>}>
                    <dl className="fact-list">
                      <div><dt>LAN</dt><dd className="technical">{lanOf(reach.paths, row.name)}</dd></div>
                      <div><dt>24h uptime</dt><dd className="num">{percent(row.uptime_24h)}</dd></div>
                      <div><dt>7d uptime</dt><dd className="num">{percent(row.uptime_7d)}</dd></div>
                      <div><dt>Last down</dt><dd className="num">{lastDown(row.last_down)}</dd></div>
                    </dl>
                  </Disclosure>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </Panel>
      <Panel title="Network diagnostics" action={
        <div className="row-actions">
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void run(paths, "Checked paths")}>{busy === paths ? "Checking paths…" : "Check paths"}</Button>
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void run(pins, "Checked DNS pins")}>{busy === pins ? "Checking DNS pins…" : "Check DNS pins"}</Button>
        </div>
      }>
        {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
        {!reach ? <Empty>Network diagnostics have not been read.</Empty> : (
          <dl className="fact-list">
            <div><dt>Tunnel</dt><dd>{reach.tunnel.guest || "Not configured"}{reach.tunnel.connections === null ? "" : ` · ${reach.tunnel.connections} connections`}{reach.tunnel.detail ? ` · ${reach.tunnel.detail}` : ""}</dd></div>
            <div><dt>WAN</dt><dd>{reach.wan.port ? `Port ${reach.wan.port}` : "Not configured"}{reach.wan.guest ? ` on guest ${reach.wan.guest}` : ""}{reach.wan.listening === null ? "" : reach.wan.listening ? " · Listening" : " · Not listening"}</dd></div>
            <div><dt>DNS pins</dt><dd>{reach.pins.summary}{reach.pins.checked && reach.pins.rows.some((row) => !row.ok) ? `. ${reach.pins.rows.filter((row) => !row.ok).map((row) => row.name).join(", ")}` : ""}</dd></div>
            <div><dt>Multicast snooping</dt><dd>{reach.multicast_snooping === null ? "Not reported" : reach.multicast_snooping ? "On" : "Off"}</dd></div>
          </dl>
        )}
      </Panel>
    </Page>
  );
}

function lanOf(paths: { name: string; lan: string }[], name: string) {
  return paths.find((row) => row.name === name)?.lan || "—";
}

function lastDown(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}):\d{2}(?:\.\d+)?$/);
  return match ? `${match[1]} ${match[2]}` : text;
}

function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function safeHref(value: string | undefined) {
  return value && /^https?:\/\//.test(value) ? value : "";
}
