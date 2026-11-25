import { useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Logo } from "./Logo";

export function Login({ error, busy, onSubmit }: {
  error: string;
  busy: boolean;
  onSubmit: (password: string, remember: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  return (
    <main className="gate">
      <Card className="gate-frame">
        <header>
          <Logo />
          <h1>Master control panel</h1>
          <p className="quiet">Sign in to your homelab.</p>
        </header>
        <form aria-busy={busy} onSubmit={(event) => {
          event.preventDefault();
          if (!busy && password) onSubmit(password, remember);
        }}>
          <Field>
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Input id="sign-in-password" type="password" name="password" autoComplete="current-password"
              aria-invalid={Boolean(error)} aria-describedby={error ? "sign-in-error" : undefined}
              value={password} onChange={(event) => setPassword(event.target.value)} />
            {error ? <FieldError id="sign-in-error">{error}</FieldError> : null}
          </Field>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Remember this device
          </label>
          <Button type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </Card>
    </main>
  );
}
