import { FormEvent, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { API_BASE, api, getGuestToken, uploadForm } from "../lib/api";
import { formatMoney, parseCurrency } from "../lib/money";
import { KindPill, SponsorBadge } from "../components/SponsorBadge";
import type { ItemKind, Sponsor } from "../lib/api";

const METHOD_LABEL: Record<string, string> = { cash: "cash", bank_transfer: "bank transfer", promptpay: "PromptPay" };

type InvoiceResponse = {
  event: { id: string; code: string; title: string; status: string; currency?: string };
  invoice: null | {
    id: string;
    total: number;
    status: "unpaid" | "payslip_uploaded" | "paid";
    hasPayslip: boolean;
    paidAt: string | null;
    lines: Array<{
      itemId: string;
      title: string;
      description: string;
      amount: number;
      kind: ItemKind;
      sponsor: Sponsor | null;
      handedOverAt: string | null;
    }>;
    paymentMethod: string | null;
    vouchersEmailedAt: string | null;
  };
  guest?: { email: string | null; needsEmail: boolean; hasPhysical: boolean };
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
  const [email, setEmail] = useState("");

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

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await api(`/api/events/${code}/me/email`, { method: "PUT", body: JSON.stringify({ email }) }, token);
      setMsg("Thanks — your vouchers will be sent to this email once payment is confirmed.");
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
  const ccy = parseCurrency(data.event.currency);
  const hostQrSrc = pay?.hostQrImageUrl ? `${API_BASE}${pay.hostQrImageUrl}` : null;

  return (
    <section className="stack">
      <div className="card">
        <h1>{data.event.title}</h1>
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
            <p><strong>{formatMoney(inv.total, ccy)}</strong></p>
            <p>
              Status:{" "}
              <strong>
                {inv.status === "paid"
                  ? `Paid${inv.paymentMethod ? ` (${METHOD_LABEL[inv.paymentMethod] ?? inv.paymentMethod})` : ""}`
                  : inv.status === "payslip_uploaded"
                    ? "Payslip uploaded — awaiting host"
                    : "Unpaid"}
              </strong>
            </p>
            <ul>
              {inv.lines.map((l) => (
                <li key={l.itemId}>
                  <div className="line-row">
                    <strong>{l.title}</strong> — {formatMoney(l.amount, ccy)} <KindPill kind={l.kind} />
                    {l.handedOverAt && <span className="pill">Handed over</span>}
                  </div>
                  {l.description ? <p className="muted">{l.description}</p> : null}
                  <SponsorBadge sponsor={l.sponsor} />
                </li>
              ))}
            </ul>
          </div>

          {data.guest?.needsEmail && (
            <div className="card">
              <h2>Where should we send your vouchers?</h2>
              <p className="muted">You won a voucher — we email the PDF after your payment is confirmed.</p>
              <form className="stack" onSubmit={onEmail}>
                <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
                <button className="button" disabled={busy}>Save email</button>
              </form>
            </div>
          )}

          {inv.status !== "paid" && (
            <div className="card">
              <h2>Pay via PromptPay</h2>
              <p className="muted">Or pay cash / bank transfer at the desk.</p>
              <p>Amount due: <strong>{formatMoney(inv.total, ccy)}</strong></p>
              {ccy !== "THB" && (
                <p className="muted">Enter {formatMoney(inv.total, ccy)} in your banking app. PromptPay amount is filled only for Thai baht auctions.</p>
              )}
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
              <p>Payment confirmed — thank you!</p>
              {inv.lines.some((l) => l.kind === "voucher") && (
                <p>
                  {inv.vouchersEmailedAt
                    ? `Voucher PDF(s) emailed to ${data.guest?.email ?? "you"}.`
                    : "Your voucher PDF(s) will be emailed shortly."}
                </p>
              )}
              {data.guest?.hasPhysical && <p>Please collect your item(s) at the desk.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
