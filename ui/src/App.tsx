import { useEffect, useState } from "react";
import { Logo } from "./components/Logo";
import { Login } from "./components/Login";
import { Button } from "./components/ui/button";
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

const NAV = [
  ["/", "Overview"],
  ["/guests", "Machines"],
  ["/reach", "Reach"],
  ["/storage", "Storage"],
  ["/jobs", "Jobs"],
  ["/system", "System"],
] as const;

export function App({ initial = null, live = true, initialPath = "/" }: Props) {
  const [state, setState] = useState<ViewState | null>(initial);
  const [path, setPath] = useState(initialPath);
  const [ready, setReady] = useState(initial !== null || !live);

  useEffect(() => {
    if (!live) {
      return;
    }
    let stop = false;
    const pull = async () => {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (stop) {
        return;
      }
      if (response.status === 401) {
        setState(null);
        setReady(true);
        return;
      }
      if (response.ok) {
        setState((await response.json()) as ViewState);
        setReady(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 10000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [live]);

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
    if (live) {
      window.history.pushState(null, "", next);
    }
    setPath(next);
  }

  if (!ready) {
    return <p className="quiet boot">Reading the host.</p>;
  }
  if (!state) {
    return <Gate />;
  }

  const page = route(path, state, setState, go);
  return (
    <TooltipProvider>
    <div className="shell">
      <aside>
        <Button type="button" variant="ghost" className="brand h-auto justify-start px-0" aria-label="Home" onClick={() => go("/")}>
          <Logo />
          <span>Master control panel</span>
        </Button>
        <nav>
          {NAV.map(([href, label]) => (
            <a
              key={href}
              href={href}
              aria-current={current(path, href) ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go(href);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <Button type="button" variant="ghost" className="version mt-auto h-auto justify-start px-0 text-[var(--muted)]" onClick={() => go("/system")}>
          {state.panel.version || "dev"}
        </Button>
      </aside>
      <main>{page}</main>
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

function current(path: string, href: string) {
  if (href === "/") {
    return path === "/";
  }
  return path === href || path.startsWith(`${href}/`);
}

function route(path: string, state: ViewState, setState: (next: ViewState) => void, go: (next: string) => void) {
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
    return <Jobs state={state} path={path} onState={setState} />;
  }
  if (path === "/recovery") {
    return <Recovery state={state} />;
  }
  if (path === "/system") {
    return <SystemPage state={state} />;
  }
  return <Overview state={state} go={go} />;
}
