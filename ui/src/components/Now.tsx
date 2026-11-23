import { useState } from "react";
import { FadeText } from "./FadeText";
import type { Now as NowState } from "../types";

function currentLine(step: string, guest: string, elapsed: string) {
  const place = `${step} on ${guest}`;
  return elapsed ? `${place}, ${elapsed} elapsed.` : `${place}.`;
}

export function Now({ now, confirmation }: { now: NowState; confirmation: string }) {
  return (
    <section className="now">
      <h2>Now</h2>
      {now.idle ? (
        <p>
          <FadeText text={now.text} />
        </p>
      ) : (
        <>
          {now.jobs.map((job) => (
            <p key={job.label}>
              <FadeText
                text={
                  job.elapsed
                    ? `${job.label} since ${job.since}, ${job.elapsed} elapsed.`
                    : `${job.label} since ${job.since}.`
                }
              />
            </p>
          ))}
          {now.timeline.length > 0 ? (
            <ol className="timeline">
              {now.timeline.map((item, index) =>
                item.current ? (
                  <li key={`${item.text}-${index}`} className="step-current" aria-current="step">
                    <FadeText text={currentLine(item.step, item.guest, item.elapsed)} />
                  </li>
                ) : (
                  <li key={`${item.text}-${index}`}>{item.text}</li>
                ),
              )}
            </ol>
          ) : null}
          {now.waiting ? <p>Waiting for the first step mark in this run.</p> : null}
          {now.lock ? <p className="quiet">{now.lock}</p> : null}
        </>
      )}
      <Actions idle={now.idle} confirmation={confirmation} />
    </section>
  );
}

function Actions({ idle, confirmation }: { idle: boolean; confirmation: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const locked = !idle || busy;
  const phrase = confirmation.trim();
  const updateReady = phrase !== "" && typed.trim() === phrase;

  async function post(path: string, body: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; started?: string };
      if (!response.ok) {
        setMessage(payload.error || "The job did not start.");
        return;
      }
      setTyped("");
      setMessage(payload.started === "update" ? "The update is starting." : "The scan is starting.");
    } catch {
      setMessage("The page could not start the job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="actions">
      <button type="button" disabled={locked} onClick={() => void post("/api/actions/scan", {})}>
        Run the scan
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (updateReady && !locked) {
            void post("/api/actions/update", { confirmation: typed.trim() });
          }
        }}
      >
        <label>
          Restart confirmation
          <input
            type="text"
            value={typed}
            placeholder={phrase || "not configured"}
            disabled={locked || phrase === ""}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <button type="submit" disabled={locked || !updateReady}>
          Run the update
        </button>
      </form>
      <p className="quiet">
        {phrase
          ? `The update starts only after you type “${phrase}”.`
          : "The update confirmation is not configured."}
      </p>
      {message ? <p className={message.endsWith("starting.") ? "ok" : "bad"}>{message}</p> : null}
    </div>
  );
}
