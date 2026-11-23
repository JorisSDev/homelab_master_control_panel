import { useEffect, useState } from "react";
import { Login } from "./components/Login";
import { Logo } from "./components/Logo";
import { Containers, Home, PanelPage, ScanJob, Storage, UpdateJob } from "./components/Sections";
import type { Section, ViewState } from "./types";

type Props = {
  initial?: ViewState | null;
  live?: boolean;
  initialSection?: Section;
};

const SECTIONS: { id: Section; label: string }[] = [
  { id: "services", label: "Containers" },
  { id: "storage", label: "Storage" },
  { id: "update", label: "Update" },
  { id: "scan", label: "Scan" },
  { id: "panel", label: "Panel" },
];

export function App({ initial = null, live = true, initialSection = "home" }: Props) {
  const [state, setState] = useState<ViewState | null>(initial);
  const [authed, setAuthed] = useState(initial != null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [section, setSection] = useState<Section>(initialSection);

  useEffect(() => {
    if (!live) {
      return;
    }
    let stop = false;
    let timer = 0;

    async function tick() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (response.status === 401) {
          if (!stop) {
            setAuthed(false);
            setState(null);
            setError("");
          }
          return;
        }
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        const next = (await response.json()) as ViewState;
        if (!stop) {
          setState(next);
          setAuthed(true);
          setError("");
          const busy = !next.scan.idle || !next.update.idle || Boolean(next.guest_updates?.active);
          const seconds = busy ? 2 : Math.max(1, next.refresh_seconds || 10);
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
  }, [live, authed]);

  async function signIn(password: string) {
    setSigningIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setLoginError(payload.error || "Sign in failed.");
        return;
      }
      setAuthed(true);
    } catch {
      setLoginError("The page could not be reached.");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    setState(null);
    setAuthed(false);
  }

  if (!authed) {
    return <Login error={loginError} busy={signingIn} onSubmit={(password) => void signIn(password)} />;
  }

  return (
    <div className="shell">
      <aside className="side">
        <button
          type="button"
          className="brand"
          aria-label="Home"
          aria-current={section === "home" ? "page" : undefined}
          onClick={() => setSection("home")}
        >
          <Logo />
          <h1>Master control panel</h1>
        </button>
        <nav>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {error ? <p className="bad">{error}</p> : null}
        {state ? (
          <>
            {section === "home" ? <Home state={state} onOpen={setSection} /> : null}
            {section === "services" ? <Containers services={state.services} /> : null}
            {section === "storage" ? <Storage storage={state.storage} /> : null}
            {section === "update" ? (
              <UpdateJob
                job={state.update}
                packages={state.packages}
                services={state.services}
                guestUpdates={state.guest_updates}
                onPackages={(packages) => setState((current) => (current ? { ...current, packages } : current))}
                onGuests={(guestUpdates) =>
                  setState((current) => (current ? { ...current, guest_updates: guestUpdates } : current))
                }
                onGuestActive={(id) =>
                  setState((current) =>
                    current ? { ...current, guest_updates: { ...current.guest_updates, active: id } } : current,
                  )
                }
              />
            ) : null}
            {section === "scan" ? <ScanJob job={state.scan} /> : null}
            {section === "panel" ? <PanelPage panel={state.panel} onSignOut={() => void signOut()} /> : null}
          </>
        ) : (
          <p className="quiet">Reading the host.</p>
        )}
      </main>
    </div>
  );
}
