import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useSearchParams } from "react-router-dom";
import { api, HostAccount, HostEventSummary, HostGuest, LivePayload, uploadForm } from "../lib/api";
import { useHostAuth } from "../lib/hostAuth";
import { Currency, CURRENCY_OPTIONS, formatMoney, parseCurrency } from "../lib/money";
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
  photo: File | null;
  startingBid: string;
  minIncrement: string;
  buyNow: string;
  voucher: File | null;
};

const emptyItem = (): DraftItem => ({
  title: "",
  description: "",
  photo: null,
  startingBid: "10",
  minIncrement: "5",
  buyNow: "",
  voucher: null,
});

function DraftPhotoPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return null;
  return <img src={url} alt="" className="thumb" />;
}

export function HostPage() {
  const { auth, refreshAuth } = useHostAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [title, setTitle] = useState("Charity Silent Auction");
  const [currency, setCurrency] = useState<Currency>("THB");
  const [eventCurrency, setEventCurrency] = useState<Currency>("THB");
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [events, setEvents] = useState<HostEventSummary[]>([]);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [settings, setSettings] = useState<HostSettings | null>(null);
  const [promptpayId, setPromptpayId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [invoices, setInvoices] = useState<HostInvoice[]>([]);
  const [guests, setGuests] = useState<HostGuest[]>([]);
  const [hosts, setHosts] = useState<HostAccount[]>([]);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [hostEmail, setHostEmail] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const joinUrl = live?.event.joinUrl;

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

  async function loadGuests(code: string) {
    const res = await api<{ guests: HostGuest[] }>(`/api/host/events/${code}/guests`);
    setGuests(res.guests);
  }

  async function loadHosts() {
    const res = await api<{ users: HostAccount[] }>("/api/host/users");
    setHosts(res.users);
  }

  async function loadEvents() {
    const res = await api<{ events: HostEventSummary[] }>("/api/host/events");
    setEvents(res.events);
    return res.events;
  }

  async function openEvent(code: string) {
    const next = await api<LivePayload>(`/api/events/${code}`);
    setLive(next);
    setEventCurrency(parseCurrency(next.event.currency));
    setSearchParams({ e: code });
    await loadInvoices(code).catch(() => setInvoices([]));
    await loadGuests(code).catch(() => setGuests([]));
  }

  useEffect(() => {
    if (!auth?.authenticated) {
      setEvents([]);
      setLive(null);
      setInvoices([]);
      setGuests([]);
      setHosts([]);
      setSettings(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadSettings();
        await loadHosts().catch(() => setHosts([]));
        const list = await loadEvents();
        if (cancelled) return;
        const wanted = searchParams.get("e") || list[0]?.code;
        if (wanted) await openEvent(wanted);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once when the host session becomes authenticated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.authenticated]);

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
          currency,
        }),
      });
      let liveNext = res;
      for (const it of draft) {
        const form = new FormData();
        form.append("title", it.title.trim());
        form.append("description", it.description.trim());
        form.append("startingBid", String(Number(it.startingBid)));
        form.append("minIncrement", String(Number(it.minIncrement)));
        if (it.buyNow.trim()) form.append("buyNow", String(Number(it.buyNow)));
        form.append("voucherPdf", it.voucher!, it.voucher!.name);
        if (it.photo) form.append("photo", it.photo, it.photo.name);
        liveNext = await uploadForm<LivePayload>(`/api/host/events/${res.event.code}/items`, form);
      }
      liveNext = await api<LivePayload>(`/api/events/${res.event.code}`);
      setLive(liveNext);
      setEventCurrency(parseCurrency(liveNext.event.currency));
      setSearchParams({ e: liveNext.event.code });
      setItems([emptyItem()]);
      await loadEvents().catch(() => undefined);
      await loadInvoices(liveNext.event.code).catch(() => undefined);
      await loadGuests(liveNext.event.code).catch(() => undefined);
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

  async function onSaveCurrency(e: FormEvent) {
    e.preventDefault();
    if (!live) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await api<LivePayload>(`/api/host/events/${live.event.code}`, {
        method: "PATCH",
        body: JSON.stringify({ currency: eventCurrency }),
      });
      setLive(next);
      await loadEvents();
      setNote("Auction currency saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAddGuest(e: FormEvent) {
    e.preventDefault();
    if (!live) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api(`/api/host/events/${live.event.code}/guests`, {
        method: "POST",
        body: JSON.stringify({ email: guestEmail, name: guestName }),
      });
      setGuestEmail("");
      setGuestName("");
      await loadGuests(live.event.code);
      setNote("Guest saved by email.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAddHost(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api("/api/host/users", {
        method: "POST",
        body: JSON.stringify({ email: hostEmail, password: hostPassword }),
      });
      setHostEmail("");
      setHostPassword("");
      await loadHosts();
      setNote("Host login added.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveHost(id: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api(`/api/host/users/${id}`, { method: "DELETE" });
      await loadHosts();
      setNote("Host removed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function currencySelect(value: Currency, onChange: (v: Currency) => void) {
    return (
      <select value={value} onChange={(e) => onChange(parseCurrency(e.target.value))}>
        {CURRENCY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (!auth) {
    return (
      <section className="stack host-page">
        <div className="card">
          <h1>Host</h1>
          <p className="muted">Loading…</p>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    );
  }

  if (auth.needsBootstrap) {
    return (
      <section className="stack host-page">
        <div className="card">
          <h1>Create owner account</h1>
          <p className="muted">First host is owner. Enter <code>BOOTSTRAP_TOKEN</code>.</p>
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
      <section className="stack host-page">
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
    <section className="stack host-page">
      <div className="card">
        <h1>Auctions</h1>
        <p className="muted">Signed in as <strong>{auth.email}</strong></p>
        {note && <p className="banner">{note}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Your auctions</h2>
        {events.length === 0 ? (
          <p className="muted">None yet — create one below.</p>
        ) : (
          <ul className="auction-list">
            {events.map((ev) => {
              const active = live?.event.code === ev.code;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    className={`auction-row${active ? " is-active" : ""}`}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      openEvent(ev.code)
                        .catch((err) => setError((err as Error).message))
                        .finally(() => setBusy(false));
                    }}
                    disabled={busy}
                  >
                    <span className="auction-meta">
                      <strong>{ev.title}</strong>
                      <span className="muted">
                        {ev.code} · {parseCurrency(ev.currency)} · {ev.itemCount} items · {ev.guestCount} guests
                      </span>
                    </span>
                    <span className={`pill status-${ev.status}`}>{ev.status}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {live && (
        <div className="card">
          <div className="row between">
            <h2>{live.event.title}</h2>
            <span className={`pill status-${live.event.status}`}>{live.event.status}</span>
          </div>
          <p>Code: <code>{live.event.code}</code></p>
          <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
          <form className="stack" onSubmit={onSaveCurrency}>
            <label>
              Currency
              {currencySelect(eventCurrency, setEventCurrency)}
            </label>
            <button className="button secondary" disabled={busy}>Save auction settings</button>
          </form>
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
                {it.photoUrl && <img src={it.photoUrl} alt="" className="thumb" />}
                {it.title} — high {formatMoney(it.highBid, parseCurrency(live.event.currency))}
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
          currency={live.event.currency}
          onRefresh={() => loadInvoices(live.event.code).catch((err) => setError((err as Error).message))}
          onConfirm={onConfirmPayment}
        />
      )}

      <div className="card">
        <h2>Users</h2>
        <p className="muted">Identity is the email address.</p>
        {live && (
          <>
            <h3>Guests — {live.event.title}</h3>
            {guests.length === 0 ? (
              <p className="muted">None yet. They appear when they join, or add by email.</p>
            ) : (
              <ul className="auction-list">
                {guests.map((g) => (
                  <li key={g.id} className="auction-row">
                    <span className="auction-meta">
                      <strong>{g.email}</strong>
                      <span className="muted">{g.name} · {g.bidCount} bids</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className="stack" onSubmit={onAddGuest}>
              <div className="row">
                <label>Email <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} required autoComplete="off" /></label>
                <label>Name <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Optional" /></label>
              </div>
              <button className="button secondary" disabled={busy}>Add guest</button>
            </form>
          </>
        )}
        <h3>Hosts</h3>
        {hosts.length === 0 ? (
          <p className="muted">No host logins loaded.</p>
        ) : (
          <ul className="auction-list">
            {hosts.map((h) => (
              <li key={h.id} className="auction-row">
                <span className="auction-meta">
                  <strong>{h.email}</strong>
                  <span className="muted">{h.role}</span>
                </span>
                {auth.role === "owner" && h.role !== "owner" && (
                  <button type="button" className="button secondary" disabled={busy} onClick={() => onRemoveHost(h.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {auth.role === "owner" && (
          <form className="stack" onSubmit={onAddHost}>
            <div className="row">
              <label>Email <input type="email" value={hostEmail} onChange={(e) => setHostEmail(e.target.value)} required autoComplete="off" /></label>
              <label>Password <input type="password" value={hostPassword} onChange={(e) => setHostPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
            </div>
            <button className="button secondary" disabled={busy}>Add host</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>New event</h2>
        <form className="stack" onSubmit={onCreate}>
          <label>Event title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <div className="row">
            <label>Starts <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
            <label>Ends <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
            <label>
              Currency
              {currencySelect(currency, setCurrency)}
            </label>
          </div>
          <h3>Items</h3>
          {items.map((it, idx) => (
            <div className="card nested" key={idx}>
              <label>Title <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} /></label>
              <label>One-liner <input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Short description" maxLength={500} /></label>
              <label>Voucher PDF <input type="file" accept="application/pdf,.pdf" onChange={(e) => updateItem(idx, { voucher: e.target.files?.[0] ?? null })} required={idx === 0} /></label>
              <label>
                Photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                  onChange={(e) => updateItem(idx, { photo: e.target.files?.[0] ?? null })}
                />
              </label>
              <DraftPhotoPreview file={it.photo} />
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
    </section>
  );
}
