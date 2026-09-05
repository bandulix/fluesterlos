import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { api, LivePayload, uploadForm } from "../lib/api";
import { Countdown } from "../components/Countdown";
import {
  HostInvoice,
  HostSettings,
  InvoicesCard,
  PaymentSettingsCard,
  uploadHostQr,
} from "./HostPayments";

type DraftItem = {
  title: string;
  description: string;
  photoUrl: string;
  startingBid: string;
  minIncrement: string;
  buyNow: string;
  voucher: File | null;
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
  voucher: null,
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
  const [settings, setSettings] = useState<HostSettings | null>(null);
  const [promptpayId, setPromptpayId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [invoices, setInvoices] = useState<HostInvoice[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const joinUrl = live?.event.joinUrl;

  async function refreshAuth() {
    const status = await api<AuthStatus>("/api/host/auth/status");
    setAuth(status);
    return status;
  }

  async function loadSettings() {
    const s = await api<HostSettings>("/api/host/settings");
    setSettings(s);
    setPromptpayId(s.promptpayId);
    setPayeeName(s.payeeName);
  }

  async function loadInvoices(code: string) {
    const res = await api<{ invoices: HostInvoice[] }>(`/api/host/events/${code}/invoices`);
    setInvoices(res.invoices);
  }

  useEffect(() => {
    localStorage.removeItem("fl_host_token");
    refreshAuth()
      .then(async (s) => {
        if (s.authenticated) await loadSettings().catch((err) => setError((err as Error).message));
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (!live?.event.code || !auth?.authenticated) return;
    loadInvoices(live.event.code).catch(() => undefined);
  }, [live?.event.code, live?.event.status, auth?.authenticated]);

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
      await loadSettings();
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
      await loadSettings();
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
      setInvoices([]);
      setSettings(null);
      await refreshAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const s = await api<HostSettings>("/api/host/settings", {
        method: "PUT",
        body: JSON.stringify({ promptpayId, payeeName }),
      });
      setSettings(s);
      setNote("Payment settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onQrUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      await uploadHostQr(file);
      await loadSettings();
      setNote("Host QR image uploaded.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const draft = items.filter((it) => it.title.trim());
      for (const it of draft) {
        if (!it.voucher) throw new Error(`Voucher PDF required for "${it.title}"`);
      }
      const res = await api<LivePayload>("/api/host/events", {
        method: "POST",
        body: JSON.stringify({
          title,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      let liveNext = res;
      for (const it of draft) {
        liveNext = await api<LivePayload>(`/api/host/events/${res.event.code}/items`, {
          method: "POST",
          body: JSON.stringify({
            title: it.title.trim(),
            description: it.description.trim(),
            photoUrl: it.photoUrl.trim() || null,
            startingBid: Number(it.startingBid),
            minIncrement: Number(it.minIncrement),
            buyNow: it.buyNow.trim() ? Number(it.buyNow) : null,
          }),
        });
        const created = liveNext.items[liveNext.items.length - 1];
        const form = new FormData();
        form.append("file", it.voucher!);
        await uploadForm(`/api/host/events/${res.event.code}/items/${created.id}/voucher`, form);
      }
      liveNext = await api<LivePayload>(`/api/events/${res.event.code}`);
      setLive(liveNext);
      setItems([emptyItem()]);
      await loadInvoices(liveNext.event.code).catch(() => undefined);
      setNote("Event created with voucher PDFs.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmPayment(invoiceId: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api<{ ok: boolean; alreadyPaid?: boolean; emailed?: number }>(
        `/api/host/invoices/${invoiceId}/confirm-payment`,
        { method: "POST" },
      );
      setNote(res.alreadyPaid ? "Already paid." : `Paid — emailed ${res.emailed ?? 0} PDF(s).`);
      if (live) await loadInvoices(live.event.code);
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
            First host is owner. Enter <code>BOOTSTRAP_TOKEN</code> from env.
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
          <p className="muted">Email + password. Registration closes after first owner.</p>
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
        <div className="row">
          <h1>Host setup</h1>
          <button type="button" className="button secondary" onClick={onLogout} disabled={authBusy}>
            Log out ({auth.email})
          </button>
        </div>
        <p className="muted">Title + one-liner + voucher PDF required. After close: one invoice per winning guest.</p>
        {note && <p className="banner">{note}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <PaymentSettingsCard
        promptpayId={promptpayId}
        payeeName={payeeName}
        settings={settings}
        busy={busy}
        setPromptpayId={setPromptpayId}
        setPayeeName={setPayeeName}
        onSave={onSaveSettings}
        onQrUpload={onQrUpload}
      />

      <div className="card">
        <h2>New event</h2>
        <form className="stack" onSubmit={onCreate}>
          <label>Event title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <div className="row">
            <label>Starts <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
            <label>Ends <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
          </div>
          <h3>Items</h3>
          {items.map((it, idx) => (
            <div className="card nested" key={idx}>
              <label>Title <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} /></label>
              <label>One-liner <input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Short description" maxLength={500} /></label>
              <label>Voucher PDF <input type="file" accept="application/pdf,.pdf" onChange={(e) => updateItem(idx, { voucher: e.target.files?.[0] ?? null })} required={idx === 0} /></label>
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
                  <Link to={`/e/${live.event.code}/invoice`}>Invoice</Link>
                </p>
              </div>
            </div>
          )}
          <h3>Items + voucher PDFs</h3>
          <ul className="stack">
            {live.items.map((it) => (
              <li key={it.id}>
                {it.title} — high {it.highBid}
                {it.hasVoucher ? " · voucher ✓" : " · voucher missing"}
              </li>
            ))}
          </ul>

        </div>
      )}

      {live && (
        <InvoicesCard
          invoices={invoices}
          busy={busy}
          onRefresh={() => loadInvoices(live.event.code).catch((err) => setError((err as Error).message))}
          onConfirm={onConfirmPayment}
        />
      )}
    </section>
  );
}
