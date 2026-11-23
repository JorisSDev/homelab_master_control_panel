import { useState } from "react";
import { Logo } from "./Logo";

export function Login({
  error,
  busy,
  onSubmit,
}: {
  error: string;
  busy: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <main className="gate">
      <Logo />
      <h1>Master control panel</h1>
      <p className="quiet">Sign in to see the host and start a job.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && password) {
            onSubmit(password);
          }
        }}
      >
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || password.length === 0}>
          Sign in
        </button>
      </form>
      {error ? <p className="bad">{error}</p> : null}
    </main>
  );
}
