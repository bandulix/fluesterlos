import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useHostAuth } from "../lib/hostAuth";

/** Accept an admin invite. The same host session then covers the auction desk and projects. */
export function HostInvite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { refreshAuth } = useHostAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/host/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      await refreshAuth();
      nav("/host", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Admin invite</h1>
      <p className="muted">Choose a password to join the host desk. You can run the auction and project funding.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Password
          <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button" disabled={busy}>Accept invite</button>
      </form>
    </section>
  );
}
