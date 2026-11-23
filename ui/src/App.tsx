import { useEffect, useState } from "react";
import { History } from "./components/History";
import { Now } from "./components/Now";
import { Schedule } from "./components/Schedule";
import { Unfinished } from "./components/Unfinished";
import type { ViewState } from "./types";

type Props = {
  initial?: ViewState | null;
  live?: boolean;
};

export function App({ initial = null, live = true }: Props) {
  const [state, setState] = useState<ViewState | null>(initial);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!live) {
      return;
    }
    let stop = false;
    let timer = 0;

    async function tick() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        const next = (await response.json()) as ViewState;
        if (!stop) {
          setState(next);
          setError("");
          const seconds = next.now.idle ? Math.max(1, next.refresh_seconds || 10) : 2;
          timer = window.setTimeout(tick, seconds * 1000);
        }
      } catch {
        if (!stop) {
          setError("The page could not be read. It will try again.");
          timer = window.setTimeout(tick, 10000);
        }
      }
    }

    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [live]);

  return (
    <main className="wrap">
      <h1>Maintenance</h1>
      <p className="lede">
        What the host is about to do to the guests, and what it already did. This page can start the
        scan, and it can start the update after you name the restart.
      </p>
      {error ? <p className="bad">{error}</p> : null}
      {state ? (
        <>
          <Now now={state.now} confirmation={state.actions.update_confirmation} />
          <Schedule schedule={state.schedule} />
          <History history={state.history} />
          <Unfinished unfinished={state.unfinished} />
        </>
      ) : (
        <p className="quiet">Reading the host.</p>
      )}
    </main>
  );
}
