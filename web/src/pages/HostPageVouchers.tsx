import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  HostAccount,
  HostEventSummary,
  HostGuest,
  HostSponsor,
  ItemKind,
  LivePayload,
  uploadForm,
} from "../lib/api";
import { useHostAuth } from "../lib/hostAuth";
import { Currency, CURRENCY_OPTIONS, parseCurrency } from "../lib/money";
import {
  DEFAULT_EVENT_TZ,
  defaultSchedule,
  offsetLabel,
  timeZoneChoices,
  wallTimeToInstant,
  wallTimeToIso,
} from "../lib/time";
import { FilePreview } from "../components/FilePreview";
import { SponsorField } from "../components/SponsorField";
import { draftSponsorsBefore } from "../lib/sponsorDrafts";
import { handoverToastText } from "../lib/deskText";
import { Toast, ToastMessage } from "../components/Toast";
import { HelpDeskCard } from "./HostHelpDesk";
import { HostEventCard, RunAction } from "./HostEventCard";
import {
  afterPaidMessage,
  emailStatusText,
  EmailStatus,
  HostInvoice,
  HostSettings,
  InvoicesCard,
  InvoiceSummary,
  PaymentMethod,
  DonationChannelsCard,
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
  kind: ItemKind;
  voucher: File | null;
  sponsorName: string;
  sponsorLogo: File | null;
};

const emptyItem = (): DraftItem => ({
  title: "",
  description: "",
  photo: null,
  startingBid: "10",
  minIncrement: "5",
  buyNow: "",
  kind: "voucher",
  voucher: null,
  sponsorName: "",
  sponsorLogo: null,
});

type EmailResult = { ok: boolean; alreadyPaid?: boolean; emailStatus?: EmailStatus; emailed?: number };

export function HostPage() {
  const { auth, refreshAuth } = useHostAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [title, setTitle] = useState("Charity Silent Auction");
  const [currency, setCurrency] = useState<Currency>("THB");
  // Create-form times are wall times in createTz (default Asia/Bangkok), never the browser's zone.
  const [createTz, setCreateTz] = useState(DEFAULT_EVENT_TZ);
  const [startsAt, setStartsAt] = useState(() => defaultSchedule(DEFAULT_EVENT_TZ).startsAt);
  const [endsAt, setEndsAt] = useState(() => defaultSchedule(DEFAULT_EVENT_TZ).endsAt);
  const scheduleTouched = useRef(false);
  const creating = useRef(false);
  const [formKey, setFormKey] = useState(0);
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
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [sponsors, setSponsors] = useState<HostSponsor[]>([]);
  const [guests, setGuests] = useState<HostGuest[]>([]);
  const [hosts, setHosts] = useState<HostAccount[]>([]);
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [hostEmail, setHostEmail] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // Event just created: scroll its card into view and highlight it briefly.
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightCode || live?.event.code !== highlightCode) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`event-card-${highlightCode}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const t = setTimeout(() => setHighlightCode(null), 3000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [highlightCode, live?.event.code]);

  async function loadSettings() {
    const s = await api<HostSettings>("/api/host/settings");
    setSettings(s);
    if (s.defaultTimezone && !scheduleTouched.current) {
      setCreateTz(s.defaultTimezone);
      const d = defaultSchedule(s.defaultTimezone);
      setStartsAt(d.startsAt);
      setEndsAt(d.endsAt);
    }
    setPromptpayId(s.promptpayId);
    setPayeeName(s.payeeName);
  }

  async function loadInvoices(code: string) {
    const res = await api<{ invoices: HostInvoice[]; summary: InvoiceSummary | null }>(
      `/api/host/events/${code}/invoices`,
    );
    setInvoices(res.invoices);
    setInvoiceSummary(res.summary);
  }

  async function loadSponsors() {
    const res = await api<{ sponsors: HostSponsor[] }>("/api/host/sponsors");
    setSponsors(res.sponsors);
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
        await loadSponsors().catch(() => setSponsors([]));
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
    setSettingsSaved(null);
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const s = await api<HostSettings>("/api/host/settings", {
        method: "PUT",
        body: JSON.stringify({ promptpayId, payeeName }),
      });
      setSettings(s);
      const saved = `✓ Saved — PromptPay ${s.promptpayId || "not set"}${s.payeeName ? ` · ${s.payeeName}` : ""}`;
      setSettingsSaved(saved);
      setToast({ id: Date.now(), text: "Payment settings saved." });
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

  function resetCreateForm(tz = createTz) {
    const d = defaultSchedule(tz);
    scheduleTouched.current = false;
    setTitle("Charity Silent Auction");
    setStartsAt(d.startsAt);
    setEndsAt(d.endsAt);
    setItems([emptyItem()]);
    setFormKey((k) => k + 1); // remounts file inputs so chosen files are cleared too
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (creating.current) return; // double click / double submit
    const startIso = wallTimeToIso(startsAt, createTz);
    const endIso = wallTimeToIso(endsAt, createTz);
    const end = wallTimeToInstant(endsAt, createTz);
    if (!startIso || !endIso || !end) {
      setError("Please enter a start and end time");
      return;
    }
    if (end.getTime() <= Date.now()) {
      setError(`The end time (${endsAt.replace("T", " ")} ${createTz}) is already in the past — the auction would be closed at once.`);
      return;
    }
    for (const it of items) {
      if (it.title.trim() && it.sponsorLogo && !it.sponsorName.trim()) {
        setError(`Enter the sponsor name for the logo on “${it.title.trim()}”`);
        return;
      }
    }
    creating.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const draft = items.filter((it) => it.title.trim());
      const res = await api<LivePayload>("/api/host/events", {
        method: "POST",
        body: JSON.stringify({ title, startsAt: startIso, endsAt: endIso, timezone: createTz, currency }),
      });
      for (const it of draft) {
        const form = new FormData();
        form.append("title", it.title.trim());
        form.append("description", it.description.trim());
        form.append("startingBid", String(Number(it.startingBid)));
        form.append("minIncrement", String(Number(it.minIncrement)));
        if (it.buyNow.trim()) form.append("buyNow", String(Number(it.buyNow)));
        form.append("kind", it.kind);
        if (it.kind === "voucher" && it.voucher) form.append("voucherPdf", it.voucher, it.voucher.name);
        if (it.sponsorName.trim()) {
          form.append("sponsorName", it.sponsorName.trim());
          if (it.sponsorLogo) form.append("sponsorLogo", it.sponsorLogo, it.sponsorLogo.name);
        }
        if (it.photo) form.append("photo", it.photo, it.photo.name);
        await uploadForm<LivePayload>(`/api/host/events/${res.event.code}/items`, form);
      }
      const liveNext = await api<LivePayload>(`/api/events/${res.event.code}`);
      setLive(liveNext);
      setSearchParams({ e: liveNext.event.code });
      setHighlightCode(liveNext.event.code);
      resetCreateForm();
      await loadEvents().catch(() => undefined);
      await loadInvoices(liveNext.event.code).catch(() => undefined);
      await loadGuests(liveNext.event.code).catch(() => undefined);
      await loadSponsors().catch(() => undefined);
      const missing = draft.filter((it) => it.kind === "voucher" && !it.voucher).length;
      setNote(
        missing
          ? `Event created. ${missing} voucher item(s) still need a PDF — attach it on the event card before payments.`
          : "Event created.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      creating.current = false;
      setBusy(false);
    }
  }

  /** Host action on the open event: busy flag, banner, then reload event, list, invoices and sponsors. */
  const runAction: RunAction = async (fn, successNote, opts) => {
    if (!live) return false;
    const code = live.event.code;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await fn();
      setLive(result && "event" in result ? result : await api<LivePayload>(`/api/events/${code}`));
      await Promise.all([
        loadEvents().catch(() => undefined),
        loadInvoices(code).catch(() => undefined),
        loadSponsors().catch(() => undefined),
      ]);
      setNote(successNote);
      return true;
    } catch (err) {
      setError((err as Error).message);
      if (opts?.rethrow) throw err;
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function invoiceAction(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await fn());
      if (live) await loadInvoices(live.event.code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onConfirmPayment(invoiceId: string, method: PaymentMethod, confirmedWithoutSlip: boolean) {
    return invoiceAction(async () => {
      const res = await api<EmailResult>(`/api/host/invoices/${invoiceId}/confirm-payment`, {
        method: "POST",
        body: JSON.stringify({ method, confirmedWithoutSlip }),
      });
      if (res.alreadyPaid) return "Already paid.";
      return afterPaidMessage(invoices.find((i) => i.id === invoiceId), res.emailStatus, res.emailed);
    });
  }

  function onSendEmail(invoiceId: string) {
    return invoiceAction(async () => {
      const res = await api<EmailResult>(`/api/host/invoices/${invoiceId}/send-email`, { method: "POST", body: "{}" });
      return emailStatusText(res.emailStatus, res.emailed);
    });
  }

  /** Optimistic in the row; here: save, then reload invoices before resolving (no global busy). */
  async function onHandover(invoiceId: string, itemId: string, handedOver: boolean) {
    if (!live) return;
    try {
      await api(`/api/host/invoices/${invoiceId}/lines/${itemId}/handover`, {
        method: "POST",
        body: JSON.stringify({ handedOver }),
      });
      const inv = invoices.find((i) => i.id === invoiceId);
      setToast({ id: Date.now(), text: handoverToastText(inv, itemId, handedOver) });
      await loadInvoices(live.event.code);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
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
        body: JSON.stringify({ phone: guestPhone, name: guestName, email: guestEmail }),
      });
      setGuestPhone("");
      setGuestEmail("");
      setGuestName("");
      await loadGuests(live.event.code);
      setNote("Guest saved by phone.");
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
        <HostEventCard
          key={live.event.code}
          live={live}
          summary={events.find((ev) => ev.code === live.event.code)}
          invoiceSummary={invoiceSummary}
          sponsors={sponsors}
          busy={busy}
          run={runAction}
          highlight={highlightCode === live.event.code}
        />
      )}

      {live && (
        <InvoicesCard
          invoices={invoices}
          busy={busy}
          currency={live.event.currency}
          timezone={live.event.timezone}
          eventCode={live.event.code}
          onRefresh={() => loadInvoices(live.event.code).catch((err) => setError((err as Error).message))}
          onConfirm={onConfirmPayment}
          onHandover={onHandover}
          onSendEmail={onSendEmail}
        />
      )}

      {live && <HelpDeskCard code={live.event.code} timezone={live.event.timezone} />}

      <div className="card">
        <h2>Users</h2>
        <p className="muted">Guests are identified by mobile number; name and email are optional.</p>
        {live && (
          <>
            <h3>Guests — {live.event.title}</h3>
            {guests.length === 0 ? (
              <p className="muted">None yet. They appear when they join, or add them by phone.</p>
            ) : (
              <ul className="auction-list">
                {guests.map((g) => (
                  <li key={g.id} className="auction-row">
                    <span className="auction-meta">
                      <strong>{g.phone ?? g.email}</strong>
                      <span className="muted">
                        {g.name}
                        {g.phone && g.email ? ` · ${g.email}` : ""} · {g.bidCount} bids
                        {g.joined === false ? " · not joined yet" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className="stack" onSubmit={onAddGuest}>
              <div className="row">
                <label>Phone <input type="tel" inputMode="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required autoComplete="off" placeholder="081 234 5678" /></label>
                <label>Name <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Optional" /></label>
                <label>Email <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} autoComplete="off" placeholder="Optional" /></label>
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
        <form className="stack" onSubmit={onCreate} key={formKey}>
          <label>Event title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <div className="row">
            <label>
              Starts
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {
                  scheduleTouched.current = true;
                  setStartsAt(e.target.value);
                }}
                required
              />
            </label>
            <label>
              Ends
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {
                  scheduleTouched.current = true;
                  setEndsAt(e.target.value);
                }}
                required
              />
            </label>
            <label>
              Time zone
              <select
                value={createTz}
                onChange={(e) => {
                  const tz = e.target.value;
                  setCreateTz(tz);
                  if (!scheduleTouched.current) {
                    const d = defaultSchedule(tz);
                    setStartsAt(d.startsAt);
                    setEndsAt(d.endsAt);
                  }
                }}
              >
                {timeZoneChoices([createTz]).map((z) => (
                  <option key={z} value={z}>{z} ({offsetLabel(z)})</option>
                ))}
              </select>
            </label>
            <label>
              Currency
              {currencySelect(currency, setCurrency)}
            </label>
          </div>
          <p className="muted">
            Times are in the event time zone: {createTz} ({offsetLabel(createTz)}), whatever zone this device is in.
          </p>
          <h3>Items</h3>
          {items.map((it, idx) => (
            <div className="card nested" key={idx}>
              <label>Title <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} /></label>
              <label>One-liner <input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Short description" maxLength={500} /></label>
              <label>
                Type
                <select value={it.kind} onChange={(e) => updateItem(idx, { kind: e.target.value as ItemKind })}>
                  <option value="voucher">Voucher (PDF emailed after payment)</option>
                  <option value="physical">Physical prize (collect at the desk)</option>
                </select>
              </label>
              {it.kind === "voucher" && (
                <label>
                  Voucher PDF <span className="muted">(optional now — can be attached later)</span>
                  <input type="file" accept="application/pdf,.pdf" onChange={(e) => updateItem(idx, { voucher: e.target.files?.[0] ?? null })} />
                </label>
              )}
              <SponsorField
                sponsors={sponsors}
                drafts={draftSponsorsBefore(items, idx)}
                name={it.sponsorName}
                logo={it.sponsorLogo}
                onName={(sponsorName) => updateItem(idx, { sponsorName })}
                onLogo={(sponsorLogo) => updateItem(idx, { sponsorLogo })}
              />
              <label>
                Photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                  onChange={(e) => updateItem(idx, { photo: e.target.files?.[0] ?? null })}
                />
              </label>
              <FilePreview file={it.photo} />
              <div className="row">
                <label>Starting <input type="number" step="0.01" value={it.startingBid} onChange={(e) => updateItem(idx, { startingBid: e.target.value })} /></label>
                <label>Min + <input type="number" step="0.01" value={it.minIncrement} onChange={(e) => updateItem(idx, { minIncrement: e.target.value })} /></label>
                <label>Buy now <input type="number" step="0.01" value={it.buyNow} onChange={(e) => updateItem(idx, { buyNow: e.target.value })} /></label>
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="button secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>Add item</button>
            <button className="button" disabled={busy || creating.current}>{busy ? "Creating…" : "Create event"}</button>
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
        savedNote={settingsSaved}
      />
      <DonationChannelsCard settings={settings} busy={busy} onSaved={() => loadSettings().catch(() => undefined)} />
      <Toast toast={toast} onDone={clearToast} />
    </section>
  );
}
