import { FormEvent } from "react";
import { API_BASE, uploadForm } from "../lib/api";

export type HostSettings = {
  promptpayId: string;
  payeeName: string;
  hasQrImage: boolean;
};

export type HostInvoice = {
  id: string;
  guestId: string;
  guestName: string;
  guestEmail: string;
  total: number;
  status: "unpaid" | "payslip_uploaded" | "paid";
  hasPayslip: boolean;
  paidAt: string | null;
  vouchersEmailedAt: string | null;
  lines: Array<{ itemId: string; title: string; description: string; amount: number }>;
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

export function InvoicesCard(props: {
  invoices: HostInvoice[];
  busy: boolean;
  onRefresh: () => void;
  onConfirm: (id: string) => void;
}) {
  const { invoices, busy, onRefresh, onConfirm } = props;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Invoices (one per winning guest)</h2>
        <button type="button" className="button secondary" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
      </div>
      {invoices.length === 0 && <p className="muted">No invoices yet (appear from winning bids).</p>}
      {invoices.map((inv) => (
        <div className="card nested" key={inv.id}>
          <p>
            <strong>{inv.guestName}</strong> ({inv.guestEmail}) —{" "}
            <strong>{inv.total.toFixed(2)}</strong> — {inv.status}
            {inv.hasPayslip ? " · payslip uploaded" : ""}
          </p>
          <ul>
            {inv.lines.map((l) => (
              <li key={l.itemId}>
                {l.title} — {l.amount.toFixed(2)}
              </li>
            ))}
          </ul>
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
            {inv.status !== "paid" && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => onConfirm(inv.id)}
              >
                Mark paid & email vouchers
              </button>
            )}
            {inv.vouchersEmailedAt && (
              <span className="muted">
                Emailed {new Date(inv.vouchersEmailedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
