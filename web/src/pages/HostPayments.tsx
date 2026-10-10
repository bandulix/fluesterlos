import { FormEvent, useState } from "react";
import { API_BASE, uploadForm } from "../lib/api";
import { DEFAULT_EVENT_TZ, formatInZone } from "../lib/time";
import { formatMoney, parseCurrency } from "../lib/money";

export type HostSettings = {
  promptpayId: string;
  payeeName: string;
  hasQrImage: boolean;
  defaultTimezone?: string;
};

import type { PaymentMethod } from "../lib/deskText";
export type { PaymentMethod } from "../lib/deskText";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  promptpay: "PromptPay",
};

import type { HostInvoice } from "../lib/deskText";
import { deskHandoverText, missingVoucherPdfs, voucherPdfWarning } from "../lib/deskText";
export type { EmailStatus, HostInvoice } from "../lib/deskText";
export { afterPaidMessage, deskHandoverText, emailStatusText, missingVoucherPdfs, voucherPdfWarning } from "../lib/deskText";

export type InvoiceSummary = {
  invoices: number;
  paid: number;
  totalAmount: number;
  paidAmount: number;
  items: number;
  handedOver: number;
};

export async function uploadHostQr(file: File) {
  const form = new FormData();
  form.append("file", file);
  return uploadForm("/api/host/settings/qr", form);
}

export function PaymentSettingsCard(props: {
  promptpayId: string;
  payeeName: string;
  settings: HostSettings | null;
  busy: boolean;
  setPromptpayId: (v: string) => void;
  setPayeeName: (v: string) => void;
  onSave: (e: FormEvent) => void;
  onQrUpload: (file: File) => void;
}) {
  const {
    promptpayId,
    payeeName,
    settings,
    busy,
    setPromptpayId,
    setPayeeName,
    onSave,
    onQrUpload,
  } = props;
  return (
    <div className="card">
      <h2>PromptPay / Thai QR</h2>
      <p className="muted">Winners scan one QR for their full invoice total. No Stripe/card.</p>
      <form className="stack" onSubmit={onSave}>
        <label>
          PromptPay ID (phone or 13-digit national ID)
          <input
            value={promptpayId}
            onChange={(e) => setPromptpayId(e.target.value)}
            placeholder="08xxxxxxxx"
          />
        </label>
        <label>
          Payee name
          <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
        </label>
        <button className="button secondary" disabled={busy}>
          Save payment settings
        </button>
      </form>
      <label>
        Optional static QR image
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onQrUpload(f);
          }}
        />
      </label>
      {settings?.hasQrImage && (
        <p className="muted">
          Host QR on file —{" "}
          <a href={`${API_BASE}/api/host/settings/qr`} target="_blank" rel="noreferrer">
            preview
          </a>
        </p>
      )}
    </div>
  );
}

function InvoiceRow(props: {
  inv: HostInvoice;
  busy: boolean;
  ccy: ReturnType<typeof parseCurrency>;
  tz: string;
  eventCode: string;
  onConfirm: (id: string, method: PaymentMethod, confirmedWithoutSlip: boolean) => void;
  onHandover: (id: string, itemId: string, handedOver: boolean) => Promise<void>;
  onSendEmail: (id: string) => void;
}) {
  const { inv, busy, ccy, tz, eventCode, onConfirm, onHandover, onSendEmail } = props;
  const [method, setMethod] = useState<PaymentMethod>(inv.hasPayslip ? "promptpay" : "cash");
  const [withoutSlip, setWithoutSlip] = useState(false);
  // Optimistic handover state: the box flips immediately; only that box is disabled while saving.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const paid = inv.status === "paid";
  const needsSlipCheck = method !== "cash" && !inv.hasPayslip;
  const hasVouchers = inv.lines.some((l) => l.kind === "voucher");
  const desk = paid ? deskHandoverText(inv) : "";
  const pdfWarning = voucherPdfWarning(inv);
  const missingPdfs = missingVoucherPdfs(inv).length;

  async function toggle(itemId: string, next: boolean) {
    setOptimistic((o) => ({ ...o, [itemId]: next }));
    setPending((p) => ({ ...p, [itemId]: true }));
    try {
      await onHandover(inv.id, itemId, next);
    } catch {
      setOptimistic((o) => ({ ...o, [itemId]: !next }));
    } finally {
      setPending((p) => ({ ...p, [itemId]: false }));
      // Server data is reloaded by the parent; drop the override once it is in.
      setOptimistic((o) => {
        const { [itemId]: _drop, ...rest } = o;
        return rest;
      });
    }
  }

  return (
    <div className="card nested">
      <p>
        <strong>{inv.guestName}</strong>
        {inv.guestPhone ? ` · ${inv.guestPhone}` : ""}
        {inv.guestEmail ? ` · ${inv.guestEmail}` : " · no email"} — <strong>{formatMoney(inv.total, ccy)}</strong> —{" "}
        <span className={`pill status-${inv.status}`}>
          {paid ? `paid${inv.paymentMethod ? ` · ${METHOD_LABEL[inv.paymentMethod]}` : ""}` : inv.status.replace("_", " ")}
        </span>
        {missingPdfs > 0 && (
          <>
            {" "}
            <span className="pill warn" title="Attach the voucher PDF to the item before handing over or emailing">
              {missingPdfs === 1 ? "voucher PDF missing" : `${missingPdfs} voucher PDFs missing`}
            </span>
          </>
        )}
      </p>
      <ul className="stack">
        {inv.lines.map((l) => {
          const checked = optimistic[l.itemId] ?? Boolean(l.handedOverAt);
          return (
            <li key={l.itemId} className="line-row">
              <label className="line-row" title={paid ? "" : "Mark the invoice paid before handing over"}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!paid || Boolean(pending[l.itemId])}
                  onChange={(e) => toggle(l.itemId, e.target.checked)}
                />
                Handed over
              </label>
              <span>
                {l.title} — {formatMoney(l.amount, ccy)}
                {l.sponsorName ? ` · ${l.sponsorName}` : ""}
              </span>
              <span className={`pill kind-${l.kind}`}>{l.kind === "physical" ? "physical" : "voucher"}</span>
              {l.kind === "voucher" && !l.hasVoucher && <span className="pill">PDF missing</span>}
              {l.kind === "voucher" && l.hasVoucher && (
                <a href={`${API_BASE}/api/host/events/${eventCode}/items/${l.itemId}/voucher`} target="_blank" rel="noreferrer">
                  Voucher PDF
                </a>
              )}
              {l.handedOverAt && checked && <span className="muted">{formatInZone(l.handedOverAt, tz)}</span>}
            </li>
          );
        })}
      </ul>
      {pdfWarning && <p className="banner warn">{pdfWarning}</p>}
      {desk && <p className="banner">{desk}</p>}
      <div className="row">
        {inv.hasPayslip && (
          <a
            className="button secondary"
            href={`${API_BASE}/api/host/invoices/${inv.id}/payslip`}
            target="_blank"
            rel="noreferrer"
          >
            View payslip
          </a>
        )}
        {!paid && (
          <>
            <label>
              Method
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="promptpay">PromptPay</option>
              </select>
            </label>
            {needsSlipCheck && (
              <label className="line-row">
                <input type="checkbox" checked={withoutSlip} onChange={(e) => setWithoutSlip(e.target.checked)} />
                I checked the transfer arrived (no payslip)
              </label>
            )}
            <button
              type="button"
              className="button"
              disabled={busy || (needsSlipCheck && !withoutSlip)}
              onClick={() => onConfirm(inv.id, method, needsSlipCheck && withoutSlip)}
            >
              Mark paid{hasVouchers && inv.guestEmail ? " & email vouchers" : ""}
            </button>
          </>
        )}
        {paid && hasVouchers && inv.guestEmail && (
          <button type="button" className="button secondary" disabled={busy} onClick={() => onSendEmail(inv.id)}>
            {inv.vouchersEmailedAt ? "Resend email" : "Send email"}
          </button>
        )}
        {inv.paidAt && (
          <span className="muted">
            Paid {formatInZone(inv.paidAt, tz)}
            {inv.paidBy ? ` by ${inv.paidBy}` : ""}
          </span>
        )}
        {inv.vouchersEmailedAt && <span className="muted">Emailed {formatInZone(inv.vouchersEmailedAt, tz)}</span>}
      </div>
    </div>
  );
}

export function InvoicesCard(props: {
  invoices: HostInvoice[];
  busy: boolean;
  currency?: string;
  timezone?: string;
  eventCode: string;
  onRefresh: () => void;
  onConfirm: (id: string, method: PaymentMethod, confirmedWithoutSlip: boolean) => void;
  onHandover: (id: string, itemId: string, handedOver: boolean) => Promise<void>;
  onSendEmail: (id: string) => void;
}) {
  const { invoices, busy, onRefresh } = props;
  const ccy = parseCurrency(props.currency);
  const tz = props.timezone || DEFAULT_EVENT_TZ;
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const shown = q
    ? invoices.filter(
        (i) =>
          i.guestName.toLowerCase().includes(q) ||
          (i.guestEmail ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 && (i.guestPhone ?? "").replace(/\D/g, "").includes(digits)),
      )
    : invoices;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Payment desk</h2>
        <button type="button" className="button secondary" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
      </div>
      <p className="muted">One invoice per winning guest. Mark paid first, then tick each item as you hand it over.</p>
      {invoices.length > 0 && (
        <label>
          Find guest
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name, phone or email" />
        </label>
      )}
      {invoices.length === 0 && <p className="muted">No invoices yet (created when the auction closes).</p>}
      {shown.map((inv) => (
        <InvoiceRow
          key={inv.id}
          inv={inv}
          busy={busy}
          ccy={ccy}
          tz={tz}
          eventCode={props.eventCode}
          onConfirm={props.onConfirm}
          onHandover={props.onHandover}
          onSendEmail={props.onSendEmail}
        />
      ))}
    </div>
  );
}

export function EventStatusSummary(props: { code: string; summary: InvoiceSummary | null; currency?: string }) {
  const ccy = parseCurrency(props.currency);
  const s = props.summary;
  return (
    <div className="stack">
      {s ? (
        <div className="status-summary">
          <span><strong>{s.paid}/{s.invoices}</strong> invoices paid</span>
          <span><strong>{formatMoney(s.paidAmount, ccy)}</strong> of {formatMoney(s.totalAmount, ccy)} collected</span>
          <span><strong>{s.handedOver}/{s.items}</strong> items handed over</span>
        </div>
      ) : (
        <p className="muted">Payment and handover status appears when the auction closes.</p>
      )}
      <p className="row">
        <span className="muted">Results export:</span>
        <a href={`${API_BASE}/api/host/events/${props.code}/results.xlsx`}>Excel (.xlsx)</a>
        <a href={`${API_BASE}/api/host/events/${props.code}/results.csv`}>CSV</a>
      </p>
    </div>
  );
}
