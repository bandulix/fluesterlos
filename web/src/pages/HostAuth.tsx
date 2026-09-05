import { FormEvent } from "react";

type AuthStatus = {
  needsBootstrap: boolean;
  authenticated: boolean;
  email?: string;
};

export function HostAuthGate(props: {
  auth: AuthStatus | null;
  error: string | null;
  email: string;
  password: string;
  bootstrapToken: string;
  authBusy: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setBootstrapToken: (v: string) => void;
  onRegister: (e: FormEvent) => void;
  onLogin: (e: FormEvent) => void;
}) {
  const {
    auth, error, email, password, bootstrapToken, authBusy,
    setEmail, setPassword, setBootstrapToken, onRegister, onLogin,
  } = props;

  if (!auth) {
    return (
      <section className="stack">
        <div className="card">
          <h1>Host setup</h1>
          <p className="muted">Loading…</p>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    );
  }

  if (auth.needsBootstrap) {
    return (
      <section className="stack">
        <div className="card">
          <h1>Create owner account</h1>
          <p className="muted">First host is owner. Needs <code>BOOTSTRAP_TOKEN</code>.</p>
          <form className="stack" onSubmit={onRegister}>
            <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
            <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
            <label>Bootstrap token <input type="password" value={bootstrapToken} onChange={(e) => setBootstrapToken(e.target.value)} required autoComplete="off" /></label>
            <button className="button" disabled={authBusy}>{authBusy ? "Registering…" : "Register owner"}</button>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      </section>
    );
  }

  if (!auth.authenticated) {
    return (
      <section className="stack">
        <div className="card">
          <h1>Host login</h1>
          <p className="muted">Email + password.</p>
          <form className="stack" onSubmit={onLogin}>
            <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
            <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
            <button className="button" disabled={authBusy}>{authBusy ? "Signing in…" : "Log in"}</button>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      </section>
    );
  }

  return null;
}
