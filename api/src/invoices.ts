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
  const ev = await pool.query("SELECT event_id FROM invoices WHERE id = $1", [invoiceId]);
  if (!ev.rows[0]) throw httpError(404, "Invoice not found");
  await assertEventClosed(ev.rows[0].event_id as string);
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

    const curRes = await pool.query("SELECT currency FROM events WHERE id = $1", [invoice.event_id]);
    const currency = parseCurrency(curRes.rows[0]?.currency);

    await sendMail({
      to: invoice.guest_email,
      subject: `Your vouchers — ${eventTitle}`,
      text:
        `Hi ${invoice.guest_name},\n\n` +
        `Payment received for your winning bids at "${eventTitle}" ` +
        `(total ${formatMoney(invoice.total, currency)}).\n\n` +
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
