import { ArrowDownToLine, LogOut, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge, Empty, Notice, Page, Panel } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Field, FieldError, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { postJson } from "../lib";
import type { ViewState } from "../types";

export function Recovery({ state }: { state: ViewState }) {
  const items = state.recovery || [];
  return (
    <Page title="Recovery" context="The first things to check after the host comes back.">
      <Panel title="Host checklist">
        {items.length === 0 ? <Empty>The recovery checklist has not been read.</Empty> : (
          <ol className="checklist">
            {items.map((item) => (
              <li key={item.id}>
                <div><strong>{item.label}</strong>{item.detail ? <span className="note">{item.detail}</span> : null}</div>
                <Badge value={item.ok === false ? "Needs attention" : item.ok ? "Passed" : "Unknown"} />
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </Page>
  );
}

type Feedback = { text: string; ok: boolean };

export function SystemPage({ state }: { state: ViewState }) {
  const [releaseMessage, setReleaseMessage] = useState<Feedback | null>(null);
  const [installing, setInstalling] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<Feedback | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sessionError, setSessionError] = useState("");

  async function install() {
    setInstalling(true);
    setReleaseMessage(null);
    const result = await postJson("/api/panel/update");
    setInstalling(false);
    setReleaseMessage({ ok: result.ok, text: result.ok ? "Installing the panel." : String(result.data.error || "The panel did not update.") });
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordBusy || !current || !next || !confirm) return;
    setPasswordBusy(true);
    setPasswordMessage(null);
    const result = await postJson("/api/password", { current, new: next, confirm });
    setPasswordBusy(false);
    if (!result.ok) {
      setPasswordMessage({ ok: false, text: String(result.data.error || "The password was not changed.") });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setPasswordMessage({ ok: true, text: "The password was changed." });
  }

  async function signOut() {
    setSigningOut(true);
    setSessionError("");
    const result = await postJson("/api/logout");
    if (result.ok) {
      window.location.reload();
      return;
    }
    setSigningOut(false);
    setSessionError(String(result.data.error || "Could not sign out."));
  }

  const passwordError = passwordMessage && !passwordMessage.ok ? passwordMessage.text : "";
  const installed = state.panel.version || "Unknown";
  const published = state.panel.latest || "Unknown";
  const releaseTag = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
  const aheadOfGitHub = releaseTag.test(installed) && releaseTag.test(published)
    && installed.localeCompare(published, "en", { numeric: true }) > 0;

  return (
    <Page title="System" action={(
      <Button type="button" variant="outline" disabled={signingOut} onClick={() => void signOut()}>
        <LogOut aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}
      </Button>
    )}>
      <Notice tone="error" message={sessionError} />
      <div className="two-panels">
        <Panel title="Panel release" action={state.panel.update_available ? <Badge value="Update available" /> : undefined}>
          <dl className="fact-list">
            <div><dt>Installed version</dt><dd className="technical">{installed}</dd></div>
            <div><dt>Latest GitHub release</dt><dd className="technical">{published}</dd></div>
          </dl>
          {aheadOfGitHub ? <p className="meta">This panel is running a newer build than the latest GitHub release.</p> : null}
          {state.panel.error ? <Notice tone="warning" message={state.panel.error} /> : null}
          {releaseMessage ? <Notice tone={releaseMessage.ok ? "success" : "error"} message={releaseMessage.text} /> : null}
          {state.panel.update_available ? (
            <div><Button type="button" disabled={installing} onClick={() => void install()}>{installing ? "Installing…" : "Install this version"}</Button></div>
          ) : null}
        </Panel>
        <Panel title="Security" action={<ShieldCheck aria-hidden="true" className="quiet" />}>
          <form className="password-form" aria-busy={passwordBusy} aria-describedby={passwordError ? "password-error" : undefined} onSubmit={(event) => void changePassword(event)}>
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input id="current-password" type="password" name="current" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input id="new-password" type="password" name="new" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
              <Input id="confirm-password" type="password" name="confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </Field>
            {passwordError ? <FieldError id="password-error">{passwordError}</FieldError> : null}
            {passwordMessage?.ok ? <Notice tone="success" message={passwordMessage.text} /> : null}
            <Button type="submit" disabled={passwordBusy || !current || !next || !confirm}>{passwordBusy ? "Saving…" : "Change password"}</Button>
          </form>
        </Panel>
      </div>
      <Panel title="Operator log" action={(
        <Button variant="outline" asChild><a href="/api/report"><ArrowDownToLine aria-hidden="true" />Download a redacted report</a></Button>
      )}>
        {(state.operator || []).length === 0 ? <Empty>No panel actions have been recorded.</Empty> : (
          <ul className="activity-list">
            {(state.operator || []).map((item, index) => <li key={`${item.text}-${index}`}>{item.text}</li>)}
          </ul>
        )}
      </Panel>
    </Page>
  );
}
