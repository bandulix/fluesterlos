import { pool } from "./db.js";
import { auctionStatus, formatMoney, money, parseCurrency } from "./auction.js";
import { readDataFile } from "./storage.js";
import { sendMail, smtpConfigured } from "./mail.js";

export type InvoiceStatus = "unpaid" | "payslip_uploaded" | "paid";

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

/** Invoices only exist for final results: the auction must be closed. */
export async function assertEventClosed(eventId: string) {
  const { rows } = await pool.query("SELECT starts_at, ends_at FROM events WHERE id = $1", [eventId]);
  const ev = rows[0] as { starts_at: Date; ends_at: Date } | undefined;
  if (!ev) throw httpError(404, "Event not found");
  if (auctionStatus(ev.starts_at, ev.ends_at) !== "closed") {
    throw httpError(409, "Invoices are available after the auction closes");
  }
}

/**
 * Create/refresh one invoice per winning guest (sum of final winning bids).
 * Only runs once the auction is closed. Paid invoices are never touched; unpaid invoices
 * of guests who no longer win anything (e.g. created by an older version mid-auction) are removed.
 */
export async function ensureInvoicesForEvent(eventId: string) {
  await assertEventClosed(eventId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize per event: many winners open their invoice right at close.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`invoices:${eventId}`]);

    const winners = await client.query(
      `SELECT i.id AS item_id, i.title AS item_title, i.voucher_pdf_path,
              b.guest_id, b.amount
       FROM items i
       JOIN LATERAL (
         SELECT guest_id, amount FROM bids
         WHERE item_id = i.id
         ORDER BY amount DESC, created_at ASC
         LIMIT 1
       ) b ON true
       WHERE i.event_id = $1`,
      [eventId],
    );

    const byGuest = new Map<
      string,
      Array<{ item_id: string; item_title: string; amount: number; voucher_pdf_path: string | null }>
    >();
    for (const row of winners.rows) {
      const gid = row.guest_id as string;
      const list = byGuest.get(gid) ?? [];
      list.push({
        item_id: row.item_id,
        item_title: row.item_title,
        amount: money(row.amount),
        voucher_pdf_path: row.voucher_pdf_path,
      });
      byGuest.set(gid, list);
    }

    await client.query(
      `DELETE FROM invoices
       WHERE event_id = $1 AND status <> 'paid' AND NOT (guest_id = ANY($2::uuid[]))`,
      [eventId, [...byGuest.keys()]],
    );

    for (const [guestId, lines] of byGuest) {
      const total = money(lines.reduce((s, l) => s + l.amount, 0));
      const existing = await client.query(
        "SELECT id, status FROM invoices WHERE event_id = $1 AND guest_id = $2",
        [eventId, guestId],
      );
      if (existing.rows[0]?.status === "paid") continue;

      let invoiceId: string;
      if (existing.rows[0]) {
        invoiceId = existing.rows[0].id;
        await client.query(
          `UPDATE invoices SET total = $1,
             status = CASE WHEN status = 'payslip_uploaded' THEN status ELSE 'unpaid' END
           WHERE id = $2`,
          [total, invoiceId],
        );
        await client.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
      } else {
        const ins = await client.query(
          `INSERT INTO invoices (event_id, guest_id, total, status)
           VALUES ($1, $2, $3, 'unpaid') RETURNING id`,
          [eventId, guestId, total],
        );
        invoiceId = ins.rows[0].id;
      }
      for (const line of lines) {
        await client.query(
          `INSERT INTO invoice_lines (invoice_id, item_id, amount)
           VALUES ($1, $2, $3)
           ON CONFLICT (invoice_id, item_id) DO UPDATE SET amount = EXCLUDED.amount`,
          [invoiceId, line.item_id, line.amount],
        );
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export type PaymentMethod = "cash" | "bank_transfer" | "promptpay";
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "bank_transfer", "promptpay"];

const LINE_SELECT = `
  SELECT il.item_id, il.amount, il.handed_over_at, il.handed_over_by,
         i.title, i.description, i.kind, i.voucher_pdf_path, i.sort_order,
         s.id AS sponsor_id, s.name AS sponsor_name, s.logo_path AS sponsor_logo_path
  FROM invoice_lines il
  JOIN items i ON i.id = il.item_id
  LEFT JOIN sponsors s ON s.id = i.sponsor_id
  WHERE il.invoice_id = $1
  ORDER BY i.sort_order, i.created_at`;

export type InvoiceLineRow = {
  item_id: string;
  amount: string | number;
  handed_over_at: Date | null;
  handed_over_by: string | null;
  title: string;
  description: string;
  kind: "voucher" | "physical";
  voucher_pdf_path: string | null;
  sort_order: number;
  sponsor_id: string | null;
  sponsor_name: string | null;
  sponsor_logo_path: string | null;
};

export async function getGuestInvoice(eventId: string, guestId: string) {
  await ensureInvoicesForEvent(eventId);
  const inv = await pool.query(
    `SELECT inv.*, g.name AS guest_name, g.email AS guest_email, g.phone AS guest_phone
     FROM invoices inv
     JOIN guests g ON g.id = inv.guest_id
     WHERE inv.event_id = $1 AND inv.guest_id = $2`,
    [eventId, guestId],
  );
  const invoice = inv.rows[0];
  if (!invoice) return null;
  const lines = await pool.query(LINE_SELECT, [invoice.id]);
  return { invoice, lines: lines.rows as InvoiceLineRow[] };
}

export async function listEventInvoices(eventId: string) {
  await ensureInvoicesForEvent(eventId);
  const { rows } = await pool.query(
    `SELECT inv.*, g.name AS guest_name, g.email AS guest_email, g.phone AS guest_phone
     FROM invoices inv
     JOIN guests g ON g.id = inv.guest_id
     WHERE inv.event_id = $1
     ORDER BY g.name`,
    [eventId],
  );
  const result = [];
  for (const invoice of rows) {
    const lines = await pool.query(LINE_SELECT, [invoice.id]);
    result.push({ invoice, lines: lines.rows as InvoiceLineRow[] });
  }
  return result;
}

async function loadInvoice(invoiceId: string) {
  const { rows } = await pool.query(
    `SELECT inv.*, g.name AS guest_name, g.email AS guest_email, g.phone AS guest_phone,
            e.title AS event_title, e.currency
     FROM invoices inv
     JOIN guests g ON g.id = inv.guest_id
     JOIN events e ON e.id = inv.event_id
     WHERE inv.id = $1`,
    [invoiceId],
  );
  if (!rows[0]) throw httpError(404, "Invoice not found");
  return rows[0];
}

/**
 * Payment desk: mark an invoice paid with a method. Cash needs no payslip; bank transfer and
 * PromptPay need the guest's payslip, or the host explicitly confirming they checked the
 * transfer themselves (confirmedWithoutSlip).
 */
export async function markInvoicePaid(
  invoiceId: string,
  opts: { method: PaymentMethod; confirmedWithoutSlip?: boolean; hostEmail?: string },
) {
  const pre = await loadInvoice(invoiceId);
  await assertEventClosed(pre.event_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId]);
    const invoice = rows[0];
    if (invoice.status === "paid") {
      await client.query("COMMIT");
      return { alreadyPaid: true };
    }
    if (opts.method !== "cash" && !invoice.payslip_path && !opts.confirmedWithoutSlip) {
      await client.query("ROLLBACK");
      throw httpError(
        409,
        "No payslip uploaded — for bank transfer / PromptPay confirm that you checked the transfer, or choose cash",
      );
    }
    await client.query(
      `UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, now()),
         payment_method = $2, paid_by = $3
       WHERE id = $1`,
      [invoiceId, opts.method, opts.hostEmail ?? null],
    );
    await client.query("COMMIT");
    return { alreadyPaid: false };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

export type EmailStatus =
  | "sent"
  | "already_sent"
  | "no_email"
  | "smtp_not_configured"
  | "voucher_pdf_missing"
  | "not_paid";

/**
 * Sends the winner's confirmation email for a paid invoice: voucher items get their PDF
 * attached, physical items say "collect at the desk". Mixed wins are one email.
 * Not sent (status says why) if the guest has no email, SMTP is missing, or a voucher PDF is missing.
 */
export async function sendWinnerEmail(invoiceId: string, opts: { force?: boolean } = {}) {
  const invoice = await loadInvoice(invoiceId);
  const lines = (await pool.query(LINE_SELECT, [invoiceId])).rows as InvoiceLineRow[];
  const missing = lines.filter((l) => l.kind === "voucher" && !l.voucher_pdf_path).map((l) => l.title);
  const result = (emailStatus: EmailStatus, emailed = 0) => ({ emailStatus, emailed, missingVoucherPdfs: missing });

  if (invoice.status !== "paid") return result("not_paid");
  if (invoice.vouchers_emailed_at && !opts.force) return result("already_sent");
  if (!invoice.guest_email) return result("no_email");
  if (!smtpConfigured()) return result("smtp_not_configured");
  if (missing.length) return result("voucher_pdf_missing");

  const currency = parseCurrency(invoice.currency);
  const attachments = [];
  for (const line of lines) {
    if (line.kind !== "voucher" || !line.voucher_pdf_path) continue;
    const content = await readDataFile(line.voucher_pdf_path);
    const safe = String(line.title).replace(/[^\w.\-]+/g, "_").slice(0, 80) || "voucher";
    attachments.push({ filename: `${safe}.pdf`, content, contentType: "application/pdf" });
  }
  const physical = lines.filter((l) => l.kind === "physical");
  const itemLines = lines
    .map((l) => {
      const sponsor = l.sponsor_name ? ` (by ${l.sponsor_name})` : "";
      const how = l.kind === "physical" ? "please collect it at the desk" : "voucher PDF attached";
      return `- ${l.title}${sponsor}: ${formatMoney(l.amount, currency)} — ${how}`;
    })
    .join("\n");

  await sendMail({
    to: invoice.guest_email,
    subject: `Payment received — ${invoice.event_title}`,
    text:
      `Hi ${invoice.guest_name},\n\n` +
      `Thank you! We received your payment for "${invoice.event_title}" ` +
      `(total ${formatMoney(invoice.total, currency)}).\n\n` +
      `${itemLines}\n\n` +
      (physical.length
        ? `Please collect your item${physical.length > 1 ? "s" : ""} at the desk — bring this email or your phone.\n\n`
        : "") +
      `— FlüsterLos\n`,
    attachments,
  });
  await pool.query("UPDATE invoices SET vouchers_emailed_at = now() WHERE id = $1", [invoiceId]);
  return result("sent", attachments.length);
}

/** Mark one won item as handed over (or undo). Only for paid invoices. */
export async function setHandedOver(invoiceId: string, itemId: string, handedOver: boolean, hostEmail?: string) {
  const invoice = await loadInvoice(invoiceId);
  if (invoice.status !== "paid") throw httpError(409, "Mark the invoice paid before handing over");
  const { rows } = await pool.query(
    `UPDATE invoice_lines
     SET handed_over_at = CASE WHEN $3 THEN COALESCE(handed_over_at, now()) ELSE NULL END,
         handed_over_by = CASE WHEN $3 THEN COALESCE(handed_over_by, $4) ELSE NULL END
     WHERE invoice_id = $1 AND item_id = $2
     RETURNING handed_over_at`,
    [invoiceId, itemId, handedOver, hostEmail ?? null],
  );
  if (!rows[0]) throw httpError(404, "Item is not on this invoice");
  return { handedOverAt: rows[0].handed_over_at ? new Date(rows[0].handed_over_at).toISOString() : null };
}
