import ExcelJS from "exceljs";
import { pool } from "./db.js";
import { auctionStatus, money, parseCurrency } from "./auction.js";
import { ensureInvoicesForEvent } from "./invoices.js";

export type ResultRow = {
  lot: number;
  item: string;
  type: string;
  sponsor: string;
  winner: string;
  phone: string;
  email: string;
  amount: number | null;
  currency: string;
  paid: string;
  method: string;
  paidAt: string;
  handedOver: string;
  handedOverAt: string;
};

export const RESULT_COLUMNS: Array<{ key: keyof ResultRow; header: string; width: number }> = [
  { key: "lot", header: "Lot", width: 6 },
  { key: "item", header: "Item", width: 40 },
  { key: "type", header: "Type", width: 10 },
  { key: "sponsor", header: "Sponsor", width: 28 },
  { key: "winner", header: "Winner", width: 24 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "email", header: "Email", width: 28 },
  { key: "amount", header: "Amount", width: 12 },
  { key: "currency", header: "Currency", width: 9 },
  { key: "paid", header: "Paid", width: 7 },
  { key: "method", header: "Method", width: 14 },
  { key: "paidAt", header: "Paid at", width: 20 },
  { key: "handedOver", header: "Handed over", width: 12 },
  { key: "handedOverAt", header: "Handed over at", width: 20 },
];

const METHOD_LABEL: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", promptpay: "PromptPay" };

function iso(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) + "Z" : "";
}

/**
 * One row per item (unsold items included). Before close the winner is the current leader and
 * payment columns are empty; after close it comes from the (final) invoices.
 */
export async function eventResults(eventId: string): Promise<{ rows: ResultRow[]; closed: boolean }> {
  const ev = await pool.query("SELECT starts_at, ends_at, currency FROM events WHERE id = $1", [eventId]);
  const closed = auctionStatus(ev.rows[0].starts_at, ev.rows[0].ends_at) === "closed";
  if (closed) await ensureInvoicesForEvent(eventId);
  const currency = parseCurrency(ev.rows[0].currency);
  const { rows } = await pool.query(
    `SELECT i.sort_order, i.title, i.kind, s.name AS sponsor_name,
            w.amount, g.name AS guest_name, g.phone, g.email,
            inv.status, inv.payment_method, inv.paid_at, il.handed_over_at
     FROM items i
     LEFT JOIN sponsors s ON s.id = i.sponsor_id
     LEFT JOIN LATERAL (
       SELECT guest_id, amount FROM bids WHERE item_id = i.id
       ORDER BY amount DESC, created_at ASC LIMIT 1
     ) w ON true
     LEFT JOIN guests g ON g.id = w.guest_id
     LEFT JOIN invoices inv ON inv.event_id = i.event_id AND inv.guest_id = w.guest_id
     LEFT JOIN invoice_lines il ON il.invoice_id = inv.id AND il.item_id = i.id
     WHERE i.event_id = $1
     ORDER BY i.sort_order, i.created_at`,
    [eventId],
  );
  return {
    closed,
    rows: rows.map((r, idx) => ({
      lot: idx + 1,
      item: r.title,
      type: r.kind,
      sponsor: r.sponsor_name ?? "",
      winner: r.guest_name ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      amount: r.amount == null ? null : money(r.amount),
      currency,
      paid: r.amount == null ? "" : r.status === "paid" ? "yes" : "no",
      method: r.payment_method ? METHOD_LABEL[r.payment_method] ?? r.payment_method : "",
      paidAt: iso(r.paid_at),
      handedOver: r.amount == null ? "" : r.handed_over_at ? "yes" : "no",
      handedOverAt: iso(r.handed_over_at),
    })),
  };
}

/** CSV cell: quoted, and neutralised against spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function resultsCsv(rows: ResultRow[]): string {
  const header = RESULT_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => RESULT_COLUMNS.map((c) => csvCell(r[c.key])).join(","));
  // BOM so Excel opens UTF-8 (Thai, umlauts) correctly.
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n";
}

export async function resultsXlsx(rows: ResultRow[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FlüsterLos";
  const ws = wb.addWorksheet("Results");
  ws.columns = RESULT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  ws.getColumn("amount").numFmt = "#,##0.00";
  // Text cells are written as strings, so phone numbers like +66… stay intact.
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalRow = ws.addRow({ item: `Total — ${title}`, amount: money(total) });
  totalRow.font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
