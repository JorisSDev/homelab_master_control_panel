import { useEffect, useState } from "react";
import { History } from "./components/History";
import { Login } from "./components/Login";
import { Logo } from "./components/Logo";
import { Now } from "./components/Now";
import { Schedule } from "./components/Schedule";
import type { ViewState } from "./types";

type Props = {
  initial?: ViewState | null;
  live?: boolean;
};

export function App({ initial = null, live = true }: Props) {
  const [state, setState] = useState<ViewState | null>(initial);
  const [authed, setAuthed] = useState(initial != null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

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
    <main className="wrap">
      <header className="top">
        <Logo />
        <div>
          <h1>Master control panel</h1>
          <p className="quiet">What the host is doing, and what it already did.</p>
        </div>
        <button type="button" className="quiet-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      {error ? <p className="bad">{error}</p> : null}
      {state ? (
        <>
          <Now now={state.now} />
          <Schedule schedule={state.schedule} />
          <History history={state.history} />
        </>
      ) : (
        <p className="quiet">Reading the host.</p>
      )}
    </main>
  );
}
