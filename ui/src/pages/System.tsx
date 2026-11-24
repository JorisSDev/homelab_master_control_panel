import { useState, type FormEvent } from "react";
import { Empty, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { postJson } from "../lib";
import type { ViewState } from "../types";

export function Recovery({ state }: { state: ViewState }) {
  const items = state.recovery || [];
  return (
    <Page title="Recovery" context="The first things to check after the host comes back.">
      {items.length === 0 ? <Empty>The recovery checklist has not been read.</Empty> : null}
      <ol className="sequence">
        {items.map((item) => (
          <li key={item.id}>
            <span className={item.ok === false ? "bad" : item.ok ? "ok" : ""}>{item.ok === false ? "down" : item.ok ? "up" : "unknown"}</span>
            <span>
              {item.label}
              {item.detail ? <span className="note">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Page>
  );
}

export function SystemPage({ state }: { state: ViewState }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function install() {
    setBusy(true);
    setMessage("");
    const result = await postJson("/api/panel/update");
    setBusy(false);
    setMessage(result.ok ? "Installing the panel." : String(result.data.error || "The panel did not update."));
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordBusy(true);
    setPasswordMessage("");
    const result = await postJson("/api/password", { current, new: next, confirm });
    setPasswordBusy(false);
    if (!result.ok) {
      setPasswordMessage(String(result.data.error || "The password was not changed."));
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setPasswordMessage("The password was changed.");
  }

  async function signOut() {
    await postJson("/api/logout");
    window.location.reload();
  }

  return (
    <Page
      title="System"
      context={state.panel.version ? `Version ${state.panel.version}` : "Panel"}
      action={
        <Button type="button" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      }
    >
      <p>
        {state.panel.update_available
          ? `Version ${state.panel.latest} is published.`
          : state.panel.latest
            ? "This is the published version."
            : "Release lookup has no result."}
      </p>
      {state.panel.error ? <p className="quiet">{state.panel.error}</p> : null}
      {message ? <p className={message.startsWith("Installing") ? "ok" : "bad"}>{message}</p> : null}
      {state.panel.update_available ? (
        <Button type="button" disabled={busy} onClick={() => void install()}>
          Install this version
        </Button>
      ) : null}
      <p className="section-label">Password</p>
      <form className="password-form" onSubmit={(event) => void changePassword(event)}>
        <label>
          Current password
          <input type="password" name="current" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <label>
          New password
          <input type="password" name="new" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </label>
        <label>
          Confirm password
          <input type="password" name="confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </label>
        <Button type="submit" disabled={passwordBusy || !current || !next || !confirm}>
          Change password
        </Button>
      </form>
      {passwordMessage ? <p className={passwordMessage.startsWith("The password was changed") ? "ok" : "bad"}>{passwordMessage}</p> : null}
      <p className="section-label">Operator log</p>
      {(state.operator || []).length === 0 ? <Empty>No panel actions have been recorded.</Empty> : null}
      <ul>
        {(state.operator || []).map((item) => (
          <li key={item.text}>{item.text}</li>
        ))}
      </ul>
      <p>
        <a href="/api/report">Download a redacted report</a>
      </p>
    </Page>
  );
}
