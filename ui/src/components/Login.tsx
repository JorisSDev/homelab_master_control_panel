import { useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Logo } from "./Logo";

export function Login({
  error,
  busy,
  onSubmit,
}: {
  error: string;
  busy: boolean;
  onSubmit: (password: string, remember: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  return (
    <main className="gate">
      <Logo />
      <h1>Master control panel</h1>
      <p className="quiet">Sign in to see the host and start a job.</p>
      <Card className="w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && password) {
            onSubmit(password, remember);
          }
        }}
      >
        <label>
          Password
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Remember this device
        </label>
        <Button type="submit" disabled={busy || password.length === 0}>
          Sign in
        </Button>
      </form>
      </Card>
      {error ? <p className="bad">{error}</p> : null}
    </main>
  );
}
