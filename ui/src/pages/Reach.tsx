import { useState } from "react";
import { Badge, Empty, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
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

  const rows = reach?.monitors.rows ?? [];
  const up = rows.filter((row) => row.status === "up").length;
  const down = rows.filter((row) => row.status === "down").length;
  const headline = rows.length > 0 ? `${up} up, ${down} down` : reach?.monitors.summary || "How each service is reached.";
  const kumaHref = safeHref(reach?.kuma_url);

  return (
    <Page
      title="Reach"
      context={headline}
      action={
        <div className="row-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run("/api/reach/paths", "Checked paths")}>
            Check paths
          </Button>
          <Button type="button" disabled={busy} onClick={() => void run("/api/reach/pins", "Checked DNS pins")}>
            Check DNS pins
          </Button>
        </div>
      }
    >
      {message ? <p className={message.startsWith("Checked") ? "ok" : "bad"}>{message}</p> : null}
      {!reach ? <Empty>Reach has not been read.</Empty> : null}
      {reach ? (
        <div className="pinned">
          <p className="section-label">Network</p>
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
          {kumaHref ? (
            <p>
              <a className="text-link" href={kumaHref} target="_blank" rel="noopener noreferrer">
                Open Kuma
              </a>
            </p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <p className="section-label">Monitors</p>
              <p className="meta">Last down is within 30 days.</p>
              <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>LAN</th>
                  <th>Status</th>
                  <th className="num">24h</th>
                  <th className="num">7d</th>
                  <th className="num">Last down</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{lanOf(reach.paths, row.name)}</td>
                    <td>
                      <Badge value={row.status} />
                    </td>
                    <td className="num">{percent(row.uptime_24h)}</td>
                    <td className="num">{percent(row.uptime_7d)}</td>
                    <td className="num">{lastDown(row.last_down)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </>
          ) : null}
        </div>
      ) : null}
    </Page>
  );
}

function lanOf(paths: { name: string; lan: string }[], name: string) {
  const found = paths.find((row) => row.name === name);
  return found?.lan || "—";
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDown(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) {
    return "—";
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  const month = match ? SHORT_MONTHS[Number(match[2]) - 1] : "";
  if (!match || !month) {
    return text;
  }
  return `${Number(match[3])} ${month} ${match[4]}:${match[5]}`;
}

function percent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function safeHref(url: string | undefined) {
  if (!url) {
    return "";
  }
  return url.startsWith("https://") || url.startsWith("http://") ? url : "";
}
