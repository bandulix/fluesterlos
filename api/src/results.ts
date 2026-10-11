import ExcelJS from "exceljs";
import { pool } from "./db.js";
import { auctionStatus, money, parseCurrency } from "./auction.js";
import { ensureInvoicesForEvent } from "./invoices.js";
import { defaultEventTimeZone, offsetLabel, wallTimeParts } from "./eventTime.js";
import { csvPhone } from "./phone.js";

export type ResultRow = {
  lot: number;
  item: string;
  type: string;
  sponsor: string;
  retailValue: number | null;
  winner: string;
  phone: string;
  email: string;
  amount: number | null;
  currency: string;
  paid: string;
  method: string;
  paidAt: Date | null;
  handedOver: string;
  handedOverAt: Date | null;
  notes: string;
};

export const RESULT_COLUMNS: Array<{ key: keyof ResultRow; header: string; width: number }> = [
  { key: "lot", header: "Lot", width: 6 },
  { key: "item", header: "Item", width: 40 },
  { key: "type", header: "Type", width: 10 },
  { key: "sponsor", header: "Sponsor", width: 28 },
  { key: "retailValue", header: "Retail value", width: 12 },
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
  { key: "notes", header: "Notes", width: 30 },
];

const METHOD_LABEL: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", promptpay: "PromptPay" };

export type EventResults = { rows: ResultRow[]; closed: boolean; timezone: string; zoneLabel: string };

const TIME_KEYS = new Set<keyof ResultRow>(["paidAt", "handedOverAt"]);

/** Header with the zone the timestamps are in, e.g. "Paid at (Asia/Bangkok, UTC+7)". */
function header(c: (typeof RESULT_COLUMNS)[number], zoneLabel: string) {
  return TIME_KEYS.has(c.key) ? `${c.header} (${zoneLabel})` : c.header;
}

/** "2026-10-10 16:38" — wall time in the event zone (the zone is in the column header). */
export function formatWallTime(d: Date | null, tz: string): string {
  if (!d) return "";
  const p = wallTimeParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * One row per item (unsold items included). Before close the winner is the current leader and
 * payment columns are empty; after close it comes from the (final) invoices.
 */
export async function eventResults(eventId: string): Promise<EventResults> {
  const ev = await pool.query("SELECT starts_at, ends_at, currency, timezone FROM events WHERE id = $1", [eventId]);
  const timezone = (ev.rows[0].timezone as string | null) || defaultEventTimeZone();
  const closed = auctionStatus(ev.rows[0].starts_at, ev.rows[0].ends_at) === "closed";
  if (closed) await ensureInvoicesForEvent(eventId);
  const currency = parseCurrency(ev.rows[0].currency);
  const { rows } = await pool.query(
    `SELECT i.sort_order, i.title, i.kind, i.retail_value, i.notes, s.name AS sponsor_name,
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
    timezone,
    zoneLabel: `${timezone}, ${offsetLabel(timezone, new Date(ev.rows[0].ends_at))}`,
    rows: rows.map((r, idx) => ({
      lot: idx + 1,
      item: r.title,
      type: r.kind,
      sponsor: r.sponsor_name ?? "",
      retailValue: r.retail_value == null ? null : money(r.retail_value),
      winner: r.guest_name ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      amount: r.amount == null ? null : money(r.amount),
      currency,
      paid: r.amount == null ? "" : r.status === "paid" ? "yes" : "no",
      method: r.payment_method ? METHOD_LABEL[r.payment_method] ?? r.payment_method : "",
      paidAt: r.paid_at ? new Date(r.paid_at) : null,
      handedOver: r.amount == null ? "" : r.handed_over_at ? "yes" : "no",
      handedOverAt: r.handed_over_at ? new Date(r.handed_over_at) : null,
      notes: r.notes ?? "",
    })),
  };
}

/** CSV cell: quoted, and neutralised against spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV: timestamps as wall time in the event zone (zone in the header). Phones are written in a
 * spreadsheet-safe *readable* form instead of E.164 — "081 234 5678" for the default country,
 * "(+49) 151 23456789" otherwise — so they never start with + (which Excel reads as a formula)
 * and need no visible apostrophe. Other cells starting with = + - @ are still neutralised.
 */
export function resultsCsv(res: Pick<EventResults, "rows" | "timezone" | "zoneLabel">): string {
  const head = RESULT_COLUMNS.map((c) => csvCell(header(c, res.zoneLabel))).join(",");
  const body = res.rows.map((r) =>
    RESULT_COLUMNS.map((c) => {
      const v = r[c.key];
      if (c.key === "phone") return csvCell(csvPhone(String(v ?? "")));
      if (TIME_KEYS.has(c.key)) return csvCell(formatWallTime(v as Date | null, res.timezone));
      return csvCell(v);
    }).join(","),
  );
  // BOM so Excel opens UTF-8 (Thai, umlauts) correctly.
  return "\uFEFF" + [head, ...body].join("\r\n") + "\r\n";
}

export async function resultsXlsx(res: EventResults, title: string): Promise<Buffer> {
  const { rows, timezone, zoneLabel } = res;
  const wb = new ExcelJS.Workbook();
  wb.creator = "FlüsterLos";
  const ws = wb.addWorksheet("Results");
  ws.columns = RESULT_COLUMNS.map((c) => ({
    header: header(c, zoneLabel),
    key: c.key,
    width: TIME_KEYS.has(c.key) ? 30 : c.width,
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    // Excel dates have no zone: write the event-zone wall time as the date value.
    ws.addRow({ ...r, paidAt: wallDate(r.paidAt, timezone), handedOverAt: wallDate(r.handedOverAt, timezone) });
  }
  ws.getColumn("amount").numFmt = "#,##0.00";
  ws.getColumn("retailValue").numFmt = "#,##0.00";
  ws.getColumn("paidAt").numFmt = "yyyy-mm-dd hh:mm";
  ws.getColumn("handedOverAt").numFmt = "yyyy-mm-dd hh:mm";
  // Phones are E.164 strings in a text-formatted column, so +66… stays intact (no apostrophe).
  ws.getColumn("phone").numFmt = "@";
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalRow = ws.addRow({ item: `Total — ${title}`, amount: money(total) });
  totalRow.font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function wallDate(d: Date | null, tz: string): Date | null {
  if (!d) return null;
  const p = wallTimeParts(d, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}
