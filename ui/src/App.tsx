import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Login } from "./components/Login";
import { Navigation } from "./components/Navigation";
import { Notice } from "./components/Chrome";
import { Skeleton } from "./components/ui/skeleton";
import { TooltipProvider } from "./components/ui/tooltip";
import { Guests } from "./pages/Guests";
import { Jobs } from "./pages/Jobs";
import { Overview } from "./pages/Overview";
import { Reach } from "./pages/Reach";
import { Storage } from "./pages/Storage";
import { Recovery, SystemPage } from "./pages/System";
import { postJson } from "./lib";
import type { ViewState } from "./types";

type Props = {
  initial?: ViewState | null;
  live?: boolean;
  initialPath?: string;
};

export function App({ initial = null, live = true, initialPath = "/" }: Props) {
  const [state, setState] = useState<ViewState | null>(initial);
  const [path, setPath] = useState(initialPath);
  const [ready, setReady] = useState(initial !== null || !live);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const previousPath = useRef(initialPath);

  useEffect(() => {
    if (!live) {
      return;
    }
    let stop = false;
    let pending: AbortController | null = null;
    const pull = async () => {
      if (pending) {
        return;
      }
      const request = new AbortController();
      pending = request;
      const timeout = window.setTimeout(() => request.abort(), 30000);
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: request.signal });
        if (response.status !== 401 && !response.ok) {
          throw new Error("Status request failed");
        }
        const next = response.status === 401 ? null : (await response.json()) as ViewState;
        if (!stop) {
          setState(next);
          setReady(true);
          setRefreshFailed(false);
        }
      } catch {
        if (!stop) {
          setRefreshFailed(true);
        }
      } finally {
        window.clearTimeout(timeout);
        pending = null;
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 10000);
    return () => {
      stop = true;
      pending?.abort();
      window.clearInterval(timer);
    };
  }, [live]);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = path;
    if (previous.split("/")[1] === path.split("/")[1] || path.startsWith("/jobs/")) return;
    const machineDetail = path.startsWith("/guests/");
    if (machineDetail && window.matchMedia?.("(max-width: 1100px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const heading = machineDetail ? document.getElementById("machine-detail-title") : null;
      (heading || document.querySelector<HTMLElement>(".page-head h1"))?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [path]);

  useEffect(() => {
    if (!live) {
      return;
    }
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    setPath(window.location.pathname);
    return () => window.removeEventListener("popstate", onPop);
  }, [live]);

  function go(next: string) {
    if (next === path) return;
    if (live) {
      window.history.pushState(null, "", next);
      if (path.split("/")[1] !== next.split("/")[1]) window.scrollTo(0, 0);
    }
    setPath(next);
  }

  if (!state && (!ready || refreshFailed)) {
    return (
      <main className="boot">
        {refreshFailed ? <Notice tone="error" message="Could not read the panel. Retrying automatically." /> : (
          <div className="boot-content" role="status">
            <Skeleton className="boot-heading" />
            <Skeleton className="boot-panel" />
            <p className="boot-status quiet"><LoaderCircle aria-hidden="true" />Reading the host…</p>
          </div>
        )}
      </main>
    );
  }
  if (!state) return <Gate />;

  return (
    <TooltipProvider>
      <div className="shell">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <Navigation path={path} go={go} version={state.panel.version || "dev"} attention={refreshFailed || needsYou(state)} />
        <main className="main-content" id="main-content" tabIndex={-1}>
          {refreshFailed ? <Notice tone="warning" message="Refresh failed. Showing the last good snapshot." /> : null}
          {route(path, state, setState, go, refreshFailed)}
        </main>
      </div>
    </TooltipProvider>
  );
}

function Gate() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(password: string, remember: boolean) {
    setBusy(true);
    setError("");
    const result = await postJson("/api/login", remember ? { password, remember: true } : { password });
    setBusy(false);
    if (result.ok) {
      window.location.reload();
      return;
    }
    setError(String(result.data.error || "The password was not accepted."));
  }

  return <Login error={error} busy={busy} onSubmit={(password, remember) => void onSubmit(password, remember)} />;
}

function needsYou(state: ViewState) {
  if (state.attention) {
    return state.attention.length > 0;
  }
  return state.findings.items.length > 0;
}

function route(path: string, state: ViewState, setState: (next: ViewState) => void, go: (next: string) => void, stale: boolean) {
  if (path === "/guests" || path.startsWith("/guests/")) {
    return <Guests state={state} path={path} go={go} onState={setState} />;
  }
  if (path === "/reach") {
    return <Reach state={state} onState={setState} />;
  }
  if (path === "/storage") {
    return <Storage state={state} />;
  }
  if (path === "/jobs" || path.startsWith("/jobs/")) {
    return <Jobs state={state} path={path} onState={setState} go={go} />;
  }
  if (path === "/recovery") {
    return <Recovery state={state} />;
  }
  if (path === "/system") {
    return <SystemPage state={state} />;
  }
  return <Overview state={state} go={go} stale={stale} />;
}
