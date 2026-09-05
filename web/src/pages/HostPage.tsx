import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { api, LivePayload } from "../lib/api";
import { Countdown } from "../components/Countdown";

type DraftItem = {
  title: string;
  description: string;
  photoUrl: string;
  startingBid: string;
  minIncrement: string;
  buyNow: string;
};

type AuthStatus = {
  needsBootstrap: boolean;
  authenticated: boolean;
  email?: string;
};

const emptyItem = (): DraftItem => ({
  title: "",
  description: "",
  photoUrl: "",
  startingBid: "10",
  minIncrement: "5",
  buyNow: "",
});

export function HostPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [title, setTitle] = useState("Charity Silent Auction");
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const joinUrl = live?.event.joinUrl;

  async function refreshAuth() {
    const status = await api<AuthStatus>("/api/host/auth/status");
    setAuth(status);
    return status;
  }

  useEffect(() => {
    // Drop legacy localStorage host token from the HOST_TOKEN era.
    localStorage.removeItem("fl_host_token");
    refreshAuth().catch((err) => setError((err as Error).message));
  }, []);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await api("/api/host/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, bootstrapToken }),
      });
      setPassword("");
      setBootstrapToken("");
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await api("/api/host/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setPassword("");
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogout() {
    setAuthBusy(true);
    setError(null);
    try {
      await api("/api/host/auth/logout", { method: "POST" });
      setLive(null);
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        items: items
          .filter((it) => it.title.trim())
          .map((it) => ({
            title: it.title.trim(),
            description: it.description,
            photoUrl: it.photoUrl.trim() || null,
            startingBid: Number(it.startingBid),
            minIncrement: Number(it.minIncrement),
            buyNow: it.buyNow.trim() ? Number(it.buyNow) : null,
          })),
      };
      const res = await api<LivePayload>("/api/host/events", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setLive(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  if (!auth) {
    return (
      <section className="stack">
        <div className="card">
          <h1>Host setup</h1>
          <p className="muted">Checking host session…</p>
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
          <p className="muted">
            First registered host becomes the owner. Enter the one-time <code>BOOTSTRAP_TOKEN</code> from your server env.
          </p>
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
          <p className="muted">Sign in with your owner email and password. Open registration is closed after the first owner exists.</p>
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

  return (
    <section className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Host setup</h1>
          <button type="button" className="button secondary" onClick={onLogout} disabled={authBusy}>
            Log out ({auth.email})
          </button>
        </div>
        <p className="muted">Create an event, add items, share the QR / join link. Auction opens and closes from the schedule.</p>
        <form className="stack" onSubmit={onCreate}>
          <label>Event title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <div className="row">
            <label>Starts <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
            <label>Ends <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
          </div>
          <h2>Items</h2>
          {items.map((it, idx) => (
            <div className="card nested" key={idx}>
              <label>Title <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} /></label>
              <label>Description <textarea value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} /></label>
              <label>Photo URL <input value={it.photoUrl} onChange={(e) => updateItem(idx, { photoUrl: e.target.value })} placeholder="https://…" /></label>
              <div className="row">
                <label>Starting <input type="number" step="0.01" value={it.startingBid} onChange={(e) => updateItem(idx, { startingBid: e.target.value })} /></label>
                <label>Min + <input type="number" step="0.01" value={it.minIncrement} onChange={(e) => updateItem(idx, { minIncrement: e.target.value })} /></label>
                <label>Buy now <input type="number" step="0.01" value={it.buyNow} onChange={(e) => updateItem(idx, { buyNow: e.target.value })} /></label>
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="button secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>Add item</button>
            <button className="button" disabled={busy}>{busy ? "Creating…" : "Create event"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>

      {live && (
        <div className="card">
          <h2>{live.event.title}</h2>
          <p>Code: <code>{live.event.code}</code></p>
          <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
          {joinUrl && (
            <div className="qr-block">
              <QRCodeSVG value={joinUrl} size={180} />
              <div>
                <p><a href={joinUrl}>{joinUrl}</a></p>
                <p className="row">
                  <Link to={`/e/${live.event.code}/bid`}>Guest bid</Link>
                  <Link to={`/e/${live.event.code}/stats`}>Stats</Link>
                  <Link to={`/e/${live.event.code}/engager`}>Engager</Link>
                </p>
              </div>
            </div>
          )}
          <ul>
            {live.items.map((it) => (
              <li key={it.id}>{it.title} — high {it.highBid}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
