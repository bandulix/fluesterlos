import { pool } from "./db.js";
import { money } from "./auction.js";
import { readDataFile } from "./storage.js";
import { sendMail, smtpConfigured } from "./mail.js";

export type InvoiceStatus = "unpaid" | "payslip_uploaded" | "paid";

/** Create/refresh one invoice per winning guest (sum of winning bids). Skips paid invoices. */
export async function ensureInvoicesForEvent(eventId: string) {
  const winners = await pool.query(
    `SELECT i.id AS item_id, i.title AS item_title, i.voucher_pdf_path,
            b.guest_id, b.amount
     FROM items i
     JOIN LATERAL (
       SELECT guest_id, amount FROM bids
       WHERE item_id = i.id
       ORDER BY amount DESC, created_at DESC
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

  for (const [guestId, lines] of byGuest) {
    const total = money(lines.reduce((s, l) => s + l.amount, 0));
    const existing = await pool.query(
      "SELECT id, status FROM invoices WHERE event_id = $1 AND guest_id = $2",
      [eventId, guestId],
    );
    if (existing.rows[0]?.status === "paid") continue;

    let invoiceId: string;
    if (existing.rows[0]) {
      invoiceId = existing.rows[0].id;
      await pool.query(
        `UPDATE invoices SET total = $1,
           status = CASE WHEN status = 'payslip_uploaded' THEN status ELSE 'unpaid' END
         WHERE id = $2`,
        [total, invoiceId],
      );
      await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
    } else {
      const ins = await pool.query(
        `INSERT INTO invoices (event_id, guest_id, total, status)
         VALUES ($1, $2, $3, 'unpaid') RETURNING id`,
        [eventId, guestId, total],
      );
      invoiceId = ins.rows[0].id;
    }
    for (const line of lines) {
      await pool.query(
        `INSERT INTO invoice_lines (invoice_id, item_id, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (invoice_id, item_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [invoiceId, line.item_id, line.amount],
      );
    }
  }
}

export async function getGuestInvoice(eventId: string, guestId: string) {
  await ensureInvoicesForEvent(eventId);
  const inv = await pool.query(
    `SELECT inv.*, g.name AS guest_name, g.email AS guest_email
     FROM invoices inv
     JOIN guests g ON g.id = inv.guest_id
     WHERE inv.event_id = $1 AND inv.guest_id = $2`,
    [eventId, guestId],
  );
  const invoice = inv.rows[0];
  if (!invoice) return null;
  const lines = await pool.query(
    `SELECT il.item_id, il.amount, i.title, i.description, i.voucher_pdf_path
     FROM invoice_lines il
     JOIN items i ON i.id = il.item_id
     WHERE il.invoice_id = $1
     ORDER BY i.sort_order, i.created_at`,
    [invoice.id],
  );
  return { invoice, lines: lines.rows };
}

export async function listEventInvoices(eventId: string) {
  await ensureInvoicesForEvent(eventId);
  const { rows } = await pool.query(
    `SELECT inv.*, g.name AS guest_name, g.email AS guest_email
     FROM invoices inv
     JOIN guests g ON g.id = inv.guest_id
     WHERE inv.event_id = $1
     ORDER BY g.name`,
    [eventId],
  );
  const result = [];
  for (const invoice of rows) {
    const lines = await pool.query(
      `SELECT il.item_id, il.amount, i.title, i.description
       FROM invoice_lines il
       JOIN items i ON i.id = il.item_id
       WHERE il.invoice_id = $1
       ORDER BY i.sort_order, i.created_at`,
      [invoice.id],
    );
    result.push({ invoice, lines: lines.rows });
  }
  return result;
}

export async function confirmPaymentAndEmailVouchers(invoiceId: string, eventTitle: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invRes = await client.query(
      `SELECT inv.*, g.name AS guest_name, g.email AS guest_email
       FROM invoices inv
       JOIN guests g ON g.id = inv.guest_id
       WHERE inv.id = $1 FOR UPDATE`,
      [invoiceId],
    );
    const invoice = invRes.rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    }
    if (invoice.status === "paid" && invoice.vouchers_emailed_at) {
      await client.query("COMMIT");
      return { alreadyPaid: true, invoice };
    }
    await client.query(
      `UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, now())
       WHERE id = $1`,
      [invoiceId],
    );
    const lines = await client.query(
      `SELECT i.title, i.voucher_pdf_path
       FROM invoice_lines il
       JOIN items i ON i.id = il.item_id
       WHERE il.invoice_id = $1`,
      [invoiceId],
    );
    await client.query("COMMIT");

    if (!smtpConfigured()) {
      throw Object.assign(
        new Error("Payment marked paid, but SMTP is not configured — vouchers were not emailed"),
        { statusCode: 503 },
      );
    }

    const attachments = [];
    for (const line of lines.rows) {
      if (!line.voucher_pdf_path) continue;
      const content = await readDataFile(line.voucher_pdf_path);
      const safe = String(line.title).replace(/[^\w.\-]+/g, "_").slice(0, 80) || "voucher";
      attachments.push({
        filename: `${safe}.pdf`,
        content,
        contentType: "application/pdf",
      });
    }

    await sendMail({
      to: invoice.guest_email,
      subject: `Your vouchers — ${eventTitle}`,
      text:
        `Hi ${invoice.guest_name},\n\n` +
        `Payment received for your winning bids at "${eventTitle}" ` +
        `(total ${money(invoice.total).toFixed(2)}).\n\n` +
        `Your voucher PDF(s) are attached (one per item).\n\n` +
        `— FlüsterLos\n`,
      attachments,
    });

    await pool.query(
      "UPDATE invoices SET vouchers_emailed_at = now() WHERE id = $1",
      [invoiceId],
    );
    return { alreadyPaid: false, invoice, emailed: attachments.length };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* */
    }
    throw e;
  } finally {
    client.release();
  }
}
