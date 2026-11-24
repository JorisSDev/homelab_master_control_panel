import { useState } from "react";
import { Badge, Empty, Page } from "../components/Chrome";
import { postJson } from "../lib";
import type { ViewState } from "../types";

export function Reach({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const reach = state.reach;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(url: string, label: string) {
    setBusy(true);
    setMessage("");
    const result = await postJson(url);
    setBusy(false);
    if (!result.ok) {
      setMessage(String(result.data.error || `${label} did not finish.`));
      return;
    }
    setMessage(label);
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
  }

  return (
    <Page
      title="Reach"
      context={reach?.monitors.summary || "How each service is reached."}
      action={
        <div className="row-actions">
          <button type="button" className="quiet-button" disabled={busy} onClick={() => void run("/api/reach/paths", "Checked paths")}>
            Check paths
          </button>
          <button type="button" disabled={busy} onClick={() => void run("/api/reach/pins", "Checked DNS pins")}>
            Check DNS pins
          </button>
        </div>
      }
    >
      {message ? <p className={message.startsWith("Checked") ? "ok" : "bad"}>{message}</p> : null}
      {!reach ? <Empty>Reach has not been read.</Empty> : null}
      {reach && reach.paths.length === 0 ? <Empty>No service paths are configured.</Empty> : null}
      {reach && reach.paths.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>LAN</th>
              <th>Public</th>
              <th>Kuma</th>
            </tr>
          </thead>
          <tbody>
            {reach.paths.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  {row.lan || "—"} {mark(row.lan_ok)}
                </td>
                <td>
                  {row.public || "—"} {mark(row.public_ok)}
                </td>
                <td>{row.kuma ? <Badge value={row.kuma} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {reach ? (
        <div className="pinned">
          <p>
            Tunnel {reach.tunnel.guest || "not configured"}
            {reach.tunnel.connections === null ? "" : ` · ${reach.tunnel.connections} connections`}
            {reach.tunnel.detail ? ` · ${reach.tunnel.detail}` : ""}
          </p>
          <p>
            WAN port {reach.wan.port || "not configured"}
            {reach.wan.guest ? ` on guest ${reach.wan.guest}` : ""}
            {reach.wan.listening === null ? "" : reach.wan.listening ? " · listening" : " · not listening"}
          </p>
          <p>
            DNS pins: {reach.pins.summary}
            {reach.pins.checked && reach.pins.rows.some((row) => !row.ok)
              ? `. ${reach.pins.rows
                  .filter((row) => !row.ok)
                  .map((row) => row.name)
                  .join(", ")}`
              : ""}
          </p>
          <p>
            Multicast snooping{" "}
            {reach.multicast_snooping === null ? "was not read" : reach.multicast_snooping ? "is on" : "is off"}
          </p>
          {reach.monitors.error ? <p className="quiet">{reach.monitors.error}</p> : null}
          {reach.monitors.rows.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Monitor</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reach.monitors.rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.type}</td>
                    <td>
                      <Badge value={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}

function mark(value: boolean | null) {
  if (value === null) {
    return "";
  }
  return value ? "up" : "down";
}
