import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, assetUrl, getGuestToken, uploadForm } from "../lib/api";
import type { ItemKind, Sponsor } from "../lib/api";
import { formatAmount, parseCurrency } from "../lib/money";
import { saveImage } from "../lib/saveImage";
import { listTitles } from "../lib/listTitles";
import { formatInZone } from "../lib/time";
import { t } from "../i18n";
import { BrandMark } from "../components/BrandMark";
import { Toast, ToastMessage } from "../components/Toast";
import "../guest/guest.css";

type InvoiceResponse = {
  event: { id: string; code: string; title: string; status: string; currency?: string };
  invoice: null | {
    id: string;
    total: number;
    status: "unpaid" | "payslip_uploaded" | "paid";
    hasPayslip: boolean;
    paidAt: string | null;
    lotsTotal?: number;
    donationsTotal?: number;
    receiptName?: string | null;
    lines: Array<{
      itemId: string;
      title: string;
      description: string;
      amount: number;
      kind: ItemKind;
      sponsor: Sponsor | null;
      handedOverAt: string | null;
    }>;
    donations?: Array<{
      needId: string;
      title: string;
      beneficiary: string;
      amount: number;
      kind: "donation";
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

/** PromptPay QR drawn on a canvas, shown as an <img> so it can also be saved by long-press. */
function PromptPayQr({ payload, label }: { payload: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSrc(canvas.current?.toDataURL("image/png") ?? null));
    return () => cancelAnimationFrame(id);
  }, [payload]);
  return (
    <>
      <QRCodeCanvas ref={canvas} value={payload} size={640} marginSize={4} level="M" style={{ display: "none" }} />
      {src ? <img className="g-qr" src={src} alt={label} /> : <div className="g-qr g-qr-loading" aria-hidden="true" />}
    </>
  );
}

const emailLaterKey = (code: string) => `fl_email_later_${code.toLowerCase()}`;

export function InvoicePage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailLater, setEmailLater] = useState(() => sessionStorage.getItem(emailLaterKey(code)) === "1");
  const [receiptName, setReceiptName] = useState("");
  const [savingReceipt, setSavingReceipt] = useState(false);
  const qrWrap = useRef<HTMLDivElement>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const say = (text: string) => setToast({ id: Date.now(), text });

  const load = useCallback(async () => {
    const res = await api<InvoiceResponse>(`/api/events/${code}/invoice`, {}, token);
    setData(res);
    setEmail((prev) => prev || res.guest?.email || "");
    setReceiptName((prev) => prev || res.invoice?.receiptName || "");
  }, [code, token]);

  useEffect(() => {
    if (!token) {
      nav(`/e/${code}`, { replace: true });
      return;
    }
    load().catch((err) => setError((err as Error).message));
  }, [token, code, nav, load]);

  async function onPayslip(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await uploadForm(`/api/events/${code}/invoice/payslip`, form, token);
      say(t("inv.slipUploaded"));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setError(null);
    try {
      await api(`/api/events/${code}/me/email`, { method: "PUT", body: JSON.stringify({ email }) }, token);
      say(t("inv.emailSaved", { email }));
      setEditingEmail(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function onReceipt(e: FormEvent) {
    e.preventDefault();
    setSavingReceipt(true);
    setError(null);
    try {
      await api(`/api/events/${code}/me/receipt-name`, { method: "PUT", body: JSON.stringify({ name: receiptName }) }, token);
      say(t("inv.receiptSaved", { name: receiptName.trim() }));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingReceipt(false);
    }
  }

  async function onSaveQr(src: string | null | undefined) {
    const img = src ?? qrWrap.current?.querySelector("img")?.getAttribute("src");
    if (!img) return;
    try {
      await saveImage(img, `promptpay-${code}.png`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!data && !error) {
    return (
      <section className="g-page">
        <p className="g-loading" role="status">{t("app.loading")}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="g-page">
        <p className="g-error" role="alert">{error}</p>
      </section>
    );
  }

  const inv = data.invoice;
  const pay = data.payment;
  const ccy = parseCurrency(data.event.currency);
  const fmt = (n: number) => formatAmount(n, ccy);
  const hostQrSrc = assetUrl(pay?.hostQrImageUrl);
  const hasVoucher = Boolean(inv?.lines.some((l) => l.kind === "voucher"));
  const paid = inv?.status === "paid";
  const knownEmail = data.guest?.email ?? null;
  const toCollect = (inv?.lines ?? []).filter((l) => l.kind === "physical" && !l.handedOverAt).map((l) => l.title);
  // Voucher winners without an email: ask first (above payment) so it isn't missed — skippable.
  const emailFirst = hasVoucher && !knownEmail && !emailLater && !inv?.vouchersEmailedAt;

  const emailCard = hasVoucher && (
    <div className={`g-card${emailFirst ? " g-card-ask" : ""}`}>
      <h2>{t("inv.emailTitle")}</h2>
      {knownEmail && !editingEmail ? (
        <p className="g-email-row">
          <span>
            ✉ {inv?.vouchersEmailedAt ? t("inv.emailSent", { email: knownEmail }) : t("inv.emailSaved", { email: knownEmail })}
          </span>
          {!inv?.vouchersEmailedAt && (
            <button type="button" className="g-link" onClick={() => setEditingEmail(true)}>
              {t("inv.emailChange")}
            </button>
          )}
        </p>
      ) : (
        <form className="g-email-form" onSubmit={onEmail}>
          <p className="g-muted">{t("inv.emailHint")}</p>
          <label className="sr-only" htmlFor="g-email">{t("inv.emailLabel")}</label>
          <input
            id="g-email"
            className="g-big-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="done"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="g-primary" disabled={savingEmail}>
            {t("inv.emailSave")}
          </button>
          {emailFirst && (
            <button
              type="button"
              className="g-link g-later"
              onClick={() => {
                sessionStorage.setItem(emailLaterKey(code), "1");
                setEmailLater(true);
              }}
            >
              {t("inv.emailLater")}
            </button>
          )}
        </form>
      )}
    </div>
  );

  return (
    <section className="g-page g-invoice">
      <header className="g-header">
        <div className="g-header-main">
          <Link to={`/e/${code}/bid`} className="g-back" aria-label={t("inv.back")}>
            ‹
          </Link>
          <BrandMark />
          <h1 className="g-title">{data.event.title}</h1>
        </div>
      </header>

      <div className="g-content">
        {!inv && <p className="g-info">{data.message || t("inv.nothing")}</p>}

        {inv && (
          <>
            <div className={`g-total-card is-${inv.status}`}>
              {inv.paidAt && (
                <p className="g-receipt-date">{formatInZone(inv.paidAt, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}</p>
              )}
              <span className="g-price-label">{paid ? t("inv.title") : t("inv.total")}</span>
              <strong className="g-total">{fmt(inv.total)}</strong>
              <span className={`g-pay-status is-${inv.status}`}>
                {paid ? `✓ ${t("inv.statusPaid")}` : inv.status === "payslip_uploaded" ? t("inv.statusSlip") : t("inv.statusUnpaid")}
              </span>
              {(inv.donations?.length ?? 0) > 0 && inv.lines.length > 0 && (
                <h2 className="g-receipt-h">{t("inv.lots")}</h2>
              )}
              <ul className="g-lines">
                {inv.lines.map((l) => (
                  <li key={l.itemId}>
                    <span>
                      {l.title}
                      <small>
                        {l.kind === "physical" ? t("bid.physical") : t("bid.voucher")}
                        {l.handedOverAt ? ` · ${t("inv.handedOver")}` : ""}
                      </small>
                    </span>
                    <strong>{fmt(l.amount)}</strong>
                  </li>
                ))}
              </ul>
              {inv.lines.length > 0 && (inv.donations?.length ?? 0) > 0 && (
                <div className="g-subtotal">
                  <span>{t("inv.lotsSub")}</span>
                  <strong>{fmt(inv.lotsTotal ?? inv.lines.reduce((s, l) => s + l.amount, 0))}</strong>
                </div>
              )}
              {(inv.donations?.length ?? 0) > 0 && (
                <>
                  <h2 className="g-receipt-h">{t("inv.donations")}</h2>
                  <p className="g-muted g-small">{t("inv.receiptHint")}</p>
                  <ul className="g-lines">
                    {inv.donations!.map((d) => (
                      <li key={d.needId}>
                        <span>
                          {d.title}
                          <small>
                            {t("inv.donationNote")}
                            {d.beneficiary ? ` · ${d.beneficiary}` : ""}
                          </small>
                        </span>
                        <strong>{fmt(d.amount)}</strong>
                      </li>
                    ))}
                  </ul>
                  <div className="g-subtotal">
                    <span>{t("inv.donationsSub")}</span>
                    <strong>{fmt(inv.donationsTotal ?? inv.donations!.reduce((s, d) => s + d.amount, 0))}</strong>
                  </div>
                </>
              )}
              <div className="g-due">
                <span>{(inv.donations?.length ?? 0) > 0 ? t("inv.grand") : paid ? t("inv.paid") : t("inv.due")}</span>
                <strong>{fmt(inv.total)}</strong>
              </div>
            </div>
            <div className="g-pay-method">
              <span className="g-price-label">{t("inv.method")}</span>
              <strong>
                {inv.paymentMethod === "cash"
                  ? "Cash"
                  : inv.paymentMethod === "bank_transfer"
                    ? "Bank transfer"
                    : inv.paymentMethod === "promptpay" || pay?.promptpayPayload
                      ? "PromptPay"
                      : t("inv.deskPay")}
              </strong>
            </div>

            {(inv.donations?.length ?? 0) > 0 && (
              <form className="g-card g-card-ask" onSubmit={onReceipt}>
                <h2>{t("inv.receiptLabel")}</h2>
                <p className="g-muted">{t("inv.receiptHint")}</p>
                <label className="sr-only" htmlFor="g-receipt">{t("inv.receiptLabel")}</label>
                <input
                  id="g-receipt"
                  className="g-big-input"
                  value={receiptName}
                  onChange={(e) => setReceiptName(e.target.value)}
                  placeholder="Name or company"
                  maxLength={200}
                />
                <button className="g-primary" disabled={savingReceipt}>{t("inv.receiptSave")}</button>
                {inv.receiptName && <p className="g-ok">{t("inv.receiptSaved", { name: inv.receiptName })}</p>}
              </form>
            )}

            {emailFirst && emailCard}

            {!paid && (
              <div className="g-card g-pay">
                <h2>{t("inv.payTitle")}</h2>
                {pay?.payeeName && <p className="g-muted">{t("inv.payee", { name: pay.payeeName })}</p>}
                <div className="g-qr-wrap" ref={qrWrap}>
                  {pay?.promptpayPayload ? (
                    <PromptPayQr payload={pay.promptpayPayload} label={t("inv.payTitle")} />
                  ) : hostQrSrc ? (
                    <img className="g-qr" src={hostQrSrc} alt={t("inv.payTitle")} />
                  ) : null}
                </div>
                {pay?.promptpayPayload || hostQrSrc ? (
                  <>
                    <p className="g-muted g-center">{ccy === "THB" ? t("inv.payHint") : t("inv.payAmountNote", { amount: fmt(inv.total) })}</p>
                    <button type="button" className="g-secondary" onClick={() => onSaveQr(pay?.promptpayPayload ? null : hostQrSrc)}>
                      ⬇ {t("inv.saveQr")}
                    </button>
                    <p className="g-muted g-small g-center">{t("inv.saveQrHint")} {t("inv.orDesk")}</p>
                  </>
                ) : (
                  <p className="g-info">{t("inv.noQr")}</p>
                )}

                <h2 className="g-slip-title">{t("inv.slipTitle")}</h2>
                <label className={`g-primary g-upload${uploading ? " is-busy" : ""}`}>
                  <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={onPayslip} disabled={uploading} />
                  📷 {uploading ? t("inv.slipUploading") : inv.hasPayslip ? t("inv.slipReplace") : t("inv.slipButton")}
                </label>
              </div>
            )}

            {!emailFirst && emailCard}

            {toCollect.length > 0 && <p className="g-info">🎁 {t("inv.collectItems", { items: listTitles(toCollect) })}</p>}
          </>
        )}
        {error && <p className="g-error" role="alert">{error}</p>}
      </div>
      <Toast toast={toast} onDone={clearToast} ms={2600} />
    </section>
  );
}
