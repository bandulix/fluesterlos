/**
 * Payment-desk texts (pure, unit-tested): what the desk has to hand over, and warnings.
 */

export type PaymentMethod = "cash" | "bank_transfer" | "promptpay";

export type HostInvoice = {
  id: string;
  guestId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  total: number;
  status: "unpaid" | "payslip_uploaded" | "paid";
  paymentMethod: PaymentMethod | null;
  paidBy: string | null;
  hasPayslip: boolean;
  paidAt: string | null;
  vouchersEmailedAt: string | null;
  lines: Array<{
    itemId: string;
    title: string;
    description: string;
    amount: number;
    kind: "voucher" | "physical";
    hasVoucher: boolean;
    sponsorName: string | null;
    handedOverAt: string | null;
  }>;
  lotsTotal?: number;
  donationsTotal?: number;
  donationChannel?: "mercy" | "wolfgang" | null;
  donationChannelLabel?: string | null;
  donationChannelSource?: "threshold" | "override" | null;
  receiptName?: string | null;
  donations?: Array<{ needId: string; title: string; beneficiary: string; amount: number }>;
};

export type EmailStatus =
  | "sent"
  | "already_sent"
  | "no_email"
  | "smtp_not_configured"
  | "voucher_pdf_missing"
  | "not_paid";

export function emailStatusText(status: EmailStatus | undefined, emailed?: number): string {
  switch (status) {
    case "sent":
      return `Winner email sent${emailed ? ` with ${emailed} voucher PDF(s)` : ""}.`;
    case "already_sent":
      return "Winner email was already sent.";
    case "no_email":
      return "No email on file — hand vouchers over at the desk or ask the guest to add an email on their invoice page.";
    case "smtp_not_configured":
      return "SMTP is not configured — no email sent.";
    case "voucher_pdf_missing":
      return "Email held: a voucher PDF is missing. Upload it on the item, then press “Send email”.";
    case "not_paid":
      return "Not paid yet — no email sent.";
    default:
      return "";
  }
}


/** Voucher lines that have no PDF attached yet. */
export function missingVoucherPdfs(inv: HostInvoice) {
  return inv.lines.filter((l) => l.kind === "voucher" && !l.hasVoucher);
}

/** Warning when a voucher has no PDF: never tell the desk to print/show/email something that does not exist. */
export function voucherPdfWarning(inv: HostInvoice): string {
  const missing = missingVoucherPdfs(inv).map((l) => l.title);
  if (!missing.length) return "";
  return `⚠ Voucher PDF missing: ${missing.join(", ")} — attach it to the item on the event card before handing over or emailing.`;
}

/** What the desk has to hand over in person (vouchers with a PDF when there is no email; physical prizes). */
export function deskHandoverText(inv: HostInvoice): string {
  // Items already ticked "Handed over" are done: they drop out, and the hint disappears when all are.
  const open = inv.lines.filter((l) => !l.handedOverAt);
  const vouchers = open.filter((l) => l.kind === "voucher" && l.hasVoucher).map((l) => l.title);
  const physical = open.filter((l) => l.kind === "physical").map((l) => l.title);
  const parts: string[] = [];
  if (vouchers.length && !inv.guestEmail) parts.push(`print/show voucher(s): ${vouchers.join(", ")}`);
  if (physical.length) parts.push(`hand over: ${physical.join(", ")}`);
  return parts.length ? `At the desk — ${parts.join("; ")}.` : "";
}

/** Message after "Mark paid": email outcome, missing-PDF warning, and what is held for the desk. */
export function afterPaidMessage(inv: HostInvoice | undefined, emailStatus: EmailStatus | undefined, emailed?: number): string {
  const name = inv?.guestName ? `${inv.guestName}: ` : "";
  const desk = inv ? deskHandoverText(inv) : "";
  const warning = inv ? voucherPdfWarning(inv) : "";
  const email =
    emailStatus === "no_email"
      ? "No email on file, so nothing was emailed."
      : emailStatus === "voucher_pdf_missing" && warning
        ? "Email held until the PDF is attached (then press “Send email”)."
        : emailStatusText(emailStatus, emailed);
  return [`${name}marked paid.`, email, warning, desk].filter(Boolean).join(" ");
}

/** Toast after ticking/unticking "Handed over". */
export function handoverToastText(inv: HostInvoice | undefined, itemId: string, handedOver: boolean): string {
  const line = inv?.lines.find((l) => l.itemId === itemId);
  const what = line ? `${line.title}${inv?.guestName ? ` → ${inv.guestName}` : ""}` : "item";
  return handedOver ? `✓ Handed over: ${what}` : `Handover undone: ${what}`;
}
