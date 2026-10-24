import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import {
  api,
  API_BASE,
  HostEventSummary,
  HostSponsor,
  LiveItem,
  LivePayload,
  uploadForm,
} from "../lib/api";
import { Currency, CURRENCY_OPTIONS, formatAmount, parseCurrency } from "../lib/money";
import { Countdown } from "../components/Countdown";
import {
  browserTimeZone,
  DEFAULT_EVENT_TZ,
  formatInZone,
  formatTimeInZone,
  instantToWallTime,
  offsetLabel,
  timeZoneChoices,
  wallTimeToInstant,
  wallTimeToIso,
} from "../lib/time";
import { EventStatusSummary, InvoiceSummary } from "./HostPayments";
import { HostItemForm } from "./HostItemForm";
import { isFixedPrice } from "../lib/bidLogic";
import { hostPriceLine } from "../lib/hostText";
import { HostItemImport } from "./HostItemImport";
import { HostBulkMedia } from "./HostBulkMedia";
import { HostNeeds } from "./HostNeeds";

/** Runs a host action: busy state, error/note banner, reloads. With rethrow the caller shows the error inline. */
export type RunAction = (
  fn: () => Promise<LivePayload | void>,
  note: string,
  opts?: { rethrow?: boolean },
) => Promise<boolean>;

function closedReason(live: LivePayload, summary: HostEventSummary | undefined, tz: string): string {
  const ev = live.event;
  if (ev.status === "scheduled") return `Scheduled — opens automatically at ${formatInZone(ev.startsAt, tz)}.`;
  if (ev.status === "open") return `Open — closes automatically at ${formatInZone(ev.endsAt, tz)}.`;
  if (summary?.closedEarlyAt) {
    return `Closed early at ${formatInZone(summary.closedEarlyAt, tz)}${summary.closedBy ? ` by ${summary.closedBy}` : ""}.`;
  }
  return `Closed — the scheduled end (${formatInZone(ev.endsAt, tz)}) has passed.`;
}

export function HostEventCard(props: {
  live: LivePayload;
  summary?: HostEventSummary;
  invoiceSummary: InvoiceSummary | null;
  sponsors: HostSponsor[];
  busy: boolean;
  run: RunAction;
  /** Just created: scroll target gets a short highlight. */
  highlight?: boolean;
}) {
  const { live, summary, invoiceSummary, sponsors, busy, run, highlight } = props;
  const ev = live.event;
  const code = ev.code;
  const tz = ev.timezone || DEFAULT_EVENT_TZ;
  const ccy = parseCurrency(ev.currency);
  const closed = ev.status === "closed";
  const paidCount = summary?.paidInvoiceCount ?? invoiceSummary?.paid ?? 0;
  const reopenLocked = closed && paidCount > 0;
  const browserTz = browserTimeZone();
  const showLocal = offsetLabel(browserTz) !== offsetLabel(tz);

  const [minutes, setMinutes] = useState("10");
  const [confirmClose, setConfirmClose] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "import" | "media">(null);
  const [mediaIntro, setMediaIntro] = useState<string | undefined>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const anyBids = live.items.some((it) => it.bidCount > 0);
  const importLocked = anyBids
    ? "This auction already has bids — import items only into an auction before bidding starts (or create a new event)."
    : closed
      ? "This auction is closed — reopen it, or create a new event, to import items."
      : null;

  // Host-only notes (e.g. "Organized by …" from an import) for the item editor.
  useEffect(() => {
    if (!editing) return;
    api<{ notes: Record<string, string> }>(`/api/host/events/${code}/item-notes`)
      .then((r) => setNotes(r.notes))
      .catch(() => undefined);
  }, [editing, code]);

  // Settings form (schedule in the event zone + currency).
  const [formTz, setFormTz] = useState(tz);
  const [formStart, setFormStart] = useState(() => instantToWallTime(ev.startsAt, tz));
  const [formEnd, setFormEnd] = useState(() => instantToWallTime(ev.endsAt, tz));
  const [formCurrency, setFormCurrency] = useState<Currency>(ccy);
  useEffect(() => {
    setFormTz(tz);
    setFormStart(instantToWallTime(ev.startsAt, tz));
    setFormEnd(instantToWallTime(ev.endsAt, tz));
    setFormCurrency(parseCurrency(ev.currency));
  }, [code, ev.startsAt, ev.endsAt, tz, ev.currency]);

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    const start = wallTimeToInstant(formStart, formTz);
    const end = wallTimeToInstant(formEnd, formTz);
    const body: Record<string, string> = {};
    if (formCurrency !== ccy) body.currency = formCurrency;
    if (formTz !== tz) body.timezone = formTz;
    if (start && start.getTime() !== new Date(ev.startsAt).getTime()) body.startsAt = wallTimeToIso(formStart, formTz)!;
    if (end && end.getTime() !== new Date(ev.endsAt).getTime()) body.endsAt = wallTimeToIso(formEnd, formTz)!;
    if (Object.keys(body).length === 0) return;
    await run(
      () => api<LivePayload>(`/api/host/events/${code}`, { method: "PATCH", body: JSON.stringify(body) }),
      "Auction settings saved.",
    );
  }

  const mins = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 0)));

  async function onAttachVoucher(itemId: string, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    await run(async () => {
      await uploadForm(`/api/host/events/${code}/items/${itemId}/voucher`, form);
    }, "Voucher PDF attached.");
  }

  function lockReason(it: LiveItem): string | null {
    if (closed) return "Auction is closed: only title, description, sponsor and photo can change.";
    if (it.bidCount > 0) return "This item has bids: prices and type are locked.";
    return null;
  }

  return (
    <div id={`event-card-${live.event.code}`} className={`card event-card${highlight ? " just-created" : ""}`}>
      <div className="row between">
        <h2>{ev.title}</h2>
        <span className={`pill status-${ev.status}`}>{ev.status}</span>
      </div>
      <p>Code: <code>{code}</code></p>
      <Countdown variant="tiles" startsAt={ev.startsAt} endsAt={ev.endsAt} status={ev.status} timezone={tz} closedEarly={ev.closedEarly} />
      <div className="event-times">
        <span>
          <strong>Start</strong> {formatInZone(ev.startsAt, tz)} · <strong>End</strong> {formatInZone(ev.endsAt, tz)}{" "}
          <span className="muted">({tz}, {offsetLabel(tz, new Date(ev.endsAt))})</span>
        </span>
        {showLocal && (
          <span className="muted">
            On this device ({browserTz}): {formatInZone(ev.startsAt, browserTz)} – {formatTimeInZone(ev.endsAt, browserTz)}
          </span>
        )}
        <span>{closedReason(live, summary, tz)}</span>
      </div>

      <div className="event-controls">
        {!closed &&
          (confirmClose ? (
            <>
              <span>Close the auction now? Bidding stops immediately.</span>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setConfirmClose(false);
                  await run(() => api<LivePayload>(`/api/host/events/${code}/close`, { method: "POST", body: "{}" }), "Auction closed.");
                }}
              >
                Yes, close now
              </button>
              <button type="button" className="button secondary" onClick={() => setConfirmClose(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmClose(true)}>
              Close now
            </button>
          ))}
        <label>
          Minutes
          <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy || reopenLocked}
          title={reopenLocked ? "Invoices are already paid — reopening would change final results" : ""}
          onClick={() =>
            run(
              () =>
                api<LivePayload>(`/api/host/events/${code}/extend`, {
                  method: "POST",
                  body: JSON.stringify({ minutes: mins }),
                }),
              closed ? `Auction reopened for ${mins} minutes.` : `Extended by ${mins} minutes.`,
            )
          }
        >
          {closed ? `Reopen for ${mins} min` : `Extend by ${mins} min`}
        </button>
        {reopenLocked && <span className="muted">{paidCount} invoice(s) paid — can't reopen.</span>}
      </div>

      <details className="stack">
        <summary>Edit schedule, time zone &amp; currency</summary>
        <form className="stack" onSubmit={onSaveSettings}>
          <div className="row">
            <label>Starts <input type="datetime-local" value={formStart} onChange={(e) => setFormStart(e.target.value)} required /></label>
            <label>Ends <input type="datetime-local" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} required /></label>
            <label>
              Time zone
              <select value={formTz} onChange={(e) => setFormTz(e.target.value)}>
                {timeZoneChoices([tz]).map((z) => (
                  <option key={z} value={z}>{z} ({offsetLabel(z)})</option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select value={formCurrency} onChange={(e) => setFormCurrency(parseCurrency(e.target.value))}>
                {CURRENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">Times are entered in the event time zone ({formTz}, {offsetLabel(formTz)}).</p>
          <button className="button secondary" disabled={busy}>Save auction settings</button>
        </form>
      </details>

      {ev.joinUrl && (
        <div className="qr-block">
          <QRCodeSVG value={ev.joinUrl} size={180} />
          <div>
            <p><a href={ev.joinUrl}>{ev.joinUrl}</a></p>
            <p className="row">
              <Link to={`/e/${code}/bid`}>Guest bid</Link>
              <Link to={`/e/${code}/stats`}>Stats</Link>
              <Link to={`/e/${code}/engager`}>Engager</Link>
              <Link to={`/e/${code}/invoice`}>Invoice</Link>
            </p>
          </div>
        </div>
      )}

      <h3>Payments &amp; handover</h3>
      <EventStatusSummary code={code} summary={invoiceSummary} currency={ev.currency} />

      <div className="row between">
        <h3>Items</h3>
        <div className="row">
          {!adding && (
            <button type="button" className="button secondary" disabled={busy} onClick={() => setAdding(true)}>
              Add item
            </button>
          )}
          {panel !== "import" && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              title={importLocked ?? "Import prizes from an Excel or CSV file"}
              onClick={() => setPanel("import")}
            >
              Import items
            </button>
          )}
          {panel !== "media" && live.items.length > 0 && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setMediaIntro(undefined);
                setPanel("media");
              }}
            >
              Photos &amp; PDFs
            </button>
          )}
        </div>
      </div>
      {panel === "import" && (
        <HostItemImport
          code={code}
          ccy={ccy}
          lockedReason={importLocked}
          onClose={() => setPanel(null)}
          onImported={async (res) => {
            await run(async () => res.live, `Imported ${res.created} item${res.created === 1 ? "" : "s"}.`);
            setMediaIntro(
              `${res.created} item${res.created === 1 ? "" : "s"} imported (lots #${res.items[0]?.lot}–#${res.items[res.items.length - 1]?.lot}). ` +
                "Add photos and voucher PDFs now, or later via “Photos & PDFs”.",
            );
            setPanel("media");
          }}
        />
      )}
      {panel === "media" && (
        <HostBulkMedia
          code={code}
          items={live.items}
          intro={mediaIntro}
          onClose={() => setPanel(null)}
          onDone={async (note) => {
            await run(async () => undefined, note);
          }}
        />
      )}
      {adding && (
        <HostItemForm
          sponsors={sponsors}
          submitLabel="Add item"
          pricingLocked={closed ? "Auction is closed — new items can't be bid on until you reopen it." : null}
          onCancel={() => setAdding(false)}
          onSubmit={async (form) => {
            await run(() => uploadForm<LivePayload>(`/api/host/events/${code}/items`, form), "Item added.", { rethrow: true });
            setAdding(false);
          }}
        />
      )}
      <ul className="stack">
        {live.items.map((it, idx) => (
          <li key={it.id} className="stack">
            {it.photoUrl && <img src={`${API_BASE}${it.photoUrl}`} alt="" className="thumb" />}
            <div className="line-row">
              <span>
                <span className="muted lot-no">#{idx + 1}</span> <strong>{it.title}</strong> — {hostPriceLine(it, ccy)}
                {it.sponsor ? ` · ${it.sponsor.name}` : ""}
                {it.retailValue != null ? ` · value ${formatAmount(it.retailValue, ccy)}` : ""}
              </span>
              {isFixedPrice(it) && <span className="pill kind-fixed" title="Buy-now equals the starting bid: guests can only buy it">fixed price</span>}
              {it.kind === "physical" ? (
                <span className="pill kind-physical">physical</span>
              ) : it.hasVoucher ? (
                <>
                  <span className="pill kind-voucher">voucher ✓</span>
                  <a href={`${API_BASE}/api/host/events/${code}/items/${it.id}/voucher`} target="_blank" rel="noreferrer">
                    View PDF
                  </a>
                </>
              ) : (
                <label className="line-row">
                  <span className="pill">voucher PDF missing</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) onAttachVoucher(it.id, f);
                    }}
                  />
                </label>
              )}
            </div>
            <div className="row">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(editing === it.id ? null : it.id)}
              >
                {editing === it.id ? "Close editor" : "Edit"}
              </button>
              {it.bidCount === 0 &&
                (confirmDelete === it.id ? (
                  <>
                    <button
                      type="button"
                      className="button danger"
                      disabled={busy}
                      onClick={async () => {
                        setConfirmDelete(null);
                        await run(
                          () => api<LivePayload>(`/api/host/events/${code}/items/${it.id}`, { method: "DELETE" }),
                          `Deleted “${it.title}”.`,
                        );
                      }}
                    >
                      Yes, delete
                    </button>
                    <button type="button" className="button secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(it.id)}>
                    Delete
                  </button>
                ))}
            </div>
            {editing === it.id && (
              <HostItemForm
                key={it.id}
                item={it}
                notes={notes[it.id] ?? ""}
                sponsors={sponsors}
                pricingLocked={lockReason(it)}
                submitLabel="Save item"
                onCancel={() => setEditing(null)}
                onSubmit={async (form) => {
                  await run(
                    () => uploadForm<LivePayload>(`/api/host/events/${code}/items/${it.id}`, form, undefined, "PATCH"),
                    "Item saved.",
                    { rethrow: true },
                  );
                  setEditing(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <HostNeeds code={code} ccy={ccy} tz={tz} run={run} />
    </div>
  );
}
