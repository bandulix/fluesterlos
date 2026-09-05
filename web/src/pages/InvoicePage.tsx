import { FormEvent, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { API_BASE, api, getGuestToken, uploadForm } from "../lib/api";

type InvoiceResponse = {
  event: { id: string; code: string; title: string; status: string };
  invoice: null | {
    id: string;
    total: number;
    status: "unpaid" | "payslip_uploaded" | "paid";
    hasPayslip: boolean;
    paidAt: string | null;
    lines: Array<{ itemId: string; title: string; description: string; amount: number }>;
  };
  message?: string;
  payment?: {
    payeeName: string;
    promptpayId: string;
    promptpayPayload: string | null;
    hasHostQrImage: boolean;
    hostQrImageUrl: string | null;
  };
};

export function InvoicePage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<InvoiceResponse>(`/api/events/${code}/invoice`, {}, token);
    setData(res);
  }, [code, token]);

  useEffect(() => {
    if (!token) {
      nav(`/e/${code}`, { replace: true });
      return;
    }
    load().catch((err) => setError((err as Error).message));
  }, [token, code, nav, load]);

  async function onPayslip(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("payslip") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setMsg("Choose a payslip image or PDF");
      return;
    }
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await uploadForm(`/api/events/${code}/invoice/payslip`, form, token);
      setMsg("Payslip uploaded — waiting for host to confirm payment.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="muted">Loading invoice…</p>;
  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return null;

  const inv = data.invoice;
  const pay = data.payment;
  const hostQrSrc = pay?.hostQrImageUrl ? `${API_BASE}${pay.hostQrImageUrl}` : null;

  return (
    <section className="stack">
      <div className="card">
        <h1>Invoice — {data.event.title}</h1>
        <p className="row muted">
          <Link to={`/e/${code}/bid`}>Back to bids</Link>
          <span>Auction: {data.event.status}</span>
        </p>
        {data.message && !inv && <p className="muted">{data.message}</p>}
        {msg && <p className="banner">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {inv && (
        <>
          <div className="card">
            <h2>Your winning total</h2>
            <p><strong>{inv.total.toFixed(2)}</strong></p>
            <p>
              Status:{" "}
              <strong>
                {inv.status === "paid"
                  ? "Paid — vouchers emailed"
                  : inv.status === "payslip_uploaded"
                    ? "Payslip uploaded — awaiting host"
                    : "Unpaid"}
              </strong>
            </p>
            <ul>
              {inv.lines.map((l) => (
                <li key={l.itemId}>
                  <strong>{l.title}</strong>
                  {l.description ? ` — ${l.description}` : ""} — {l.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          </div>

          {inv.status !== "paid" && (
            <div className="card">
              <h2>Pay via PromptPay</h2>
              {pay?.payeeName && <p>Payee: {pay.payeeName}</p>}
              {pay?.promptpayId && <p className="muted">PromptPay ID: {pay.promptpayId}</p>}
              {pay?.promptpayPayload ? (
                <div className="qr-block">
                  <QRCodeSVG value={pay.promptpayPayload} size={280} />
                </div>
              ) : hostQrSrc ? (
                <div className="qr-block">
                  <img src={hostQrSrc} alt="Payment QR" width={280} height={280} />
                </div>
              ) : (
                <p className="muted">Host has not configured PromptPay / QR yet.</p>
              )}
              {pay?.hasHostQrImage && pay?.promptpayPayload && hostQrSrc && (
                <p className="muted">
                  Host also provided a static QR:{" "}
                  <a href={hostQrSrc} target="_blank" rel="noreferrer">open image</a>
                </p>
              )}
              <form className="stack" onSubmit={onPayslip}>
                <label>
                  Upload payslip (image or PDF)
                  <input type="file" name="payslip" accept="image/*,.pdf,application/pdf" required />
                </label>
                <button className="button" disabled={busy}>
                  {busy ? "Uploading…" : inv.hasPayslip ? "Replace payslip" : "Upload payslip"}
                </button>
              </form>
            </div>
          )}

          {inv.status === "paid" && (
            <div className="card">
              <p>Payment confirmed. Check your email for voucher PDF(s) — one per won item.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
