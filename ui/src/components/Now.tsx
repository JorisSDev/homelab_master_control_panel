import { useState } from "react";
import { FadeText } from "./FadeText";
import type { Now as NowState } from "../types";

export function Now({ now }: { now: NowState }) {
  return (
    <section className="now">
      <h2>Now</h2>
      <div className="status-row">
        <p className={now.idle ? "status" : "status live"}>
          <FadeText text={now.status} />
        </p>
        {now.jobs[0]?.elapsed ? <p className="elapsed">{now.jobs[0].elapsed}</p> : null}
      </div>
      <p className="detail">
        <FadeText text={now.detail} />
      </p>
      {now.jobs[0]?.started ? <p className="quiet">Started {now.jobs[0].started}</p> : null}
      {now.timeline.length > 0 ? (
        <ol className="timeline">
          {now.timeline.map((item, index) => (
            <li key={`${item.text}-${index}`} className={item.current ? "step-current" : undefined} aria-current={item.current ? "step" : undefined}>
              <span>{item.text}</span>
              {item.current ? <span className="badge">Now</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {now.waiting ? <p>The job has started. The first check will appear here.</p> : null}
      {now.lock ? <p className="quiet">{now.lock}</p> : null}
      <Actions idle={now.idle} />
    </section>
  );
}

function Actions({ idle }: { idle: boolean }) {
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

  if (confirming) {
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

  return (
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void post("/api/actions/scan", {})}>
        Run the scan
      </button>
      <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirming(true)}>
        Run the update
      </button>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
    </div>
  );
}
