import { defaultEventTimeZone } from "./eventTime.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus, money } from "./auction.js";
import { listEventInvoices, markInvoicePaid, sendWinnerEmail, setHandedOver } from "./invoices.js";
import { eventResults, resultsCsv, resultsXlsx } from "./results.js";
import type { HostUser } from "./hostAuth.js";
import {
  contentTypeFor,
  readDataFile,
  saveUpload,
} from "./storage.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date; currency?: string };

async function readMultipartFile(req: import("fastify").FastifyRequest) {
  const file = await req.file();
  if (!file) return null;
  const buffer = await file.toBuffer();
  return { filename: file.filename, mimetype: file.mimetype, buffer };
}

export async function getHostSettings() {
  const { rows } = await pool.query(
    "SELECT promptpay_id, payee_name, qr_image_path FROM host_settings WHERE id = 1",
  );
  const row = rows[0] as
    | { promptpay_id: string | null; payee_name: string | null; qr_image_path: string | null }
    | undefined;
  return {
    promptpay_id: row?.promptpay_id || process.env.PROMPTPAY_ID || null,
    payee_name: row?.payee_name || process.env.PROMPTPAY_PAYEE_NAME || null,
    qr_image_path: row?.qr_image_path ?? null,
  };
}

export function registerInvoiceHostRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    requireHost: (req: import("fastify").FastifyRequest) => Promise<unknown>;
  },
) {
  const { codeOf, getEventByCode, requireHost } = deps;
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  app.get("/api/host/settings", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const s = await getHostSettings();
    return {
      promptpayId: s.promptpay_id ?? "",
      payeeName: s.payee_name ?? "",
      hasQrImage: Boolean(s.qr_image_path),
      defaultTimezone: defaultEventTimeZone(),
    };
  });

  const settingsSchema = z.object({
    promptpayId: z.string().max(32).optional(),
    payeeName: z.string().max(200).optional(),
  });

  app.put("/api/host/settings", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.promptpayId !== undefined && parsed.data.payeeName !== undefined) {
      await pool.query(
        `UPDATE host_settings SET promptpay_id = $1, payee_name = $2, updated_at = now() WHERE id = 1`,
        [parsed.data.promptpayId.trim() || null, parsed.data.payeeName.trim() || null],
      );
    } else if (parsed.data.promptpayId !== undefined) {
      await pool.query(
        `UPDATE host_settings SET promptpay_id = $1, updated_at = now() WHERE id = 1`,
        [parsed.data.promptpayId.trim() || null],
      );
    } else if (parsed.data.payeeName !== undefined) {
      await pool.query(
        `UPDATE host_settings SET payee_name = $1, updated_at = now() WHERE id = 1`,
        [parsed.data.payeeName.trim() || null],
      );
    }
    const s = await getHostSettings();
    return {
      promptpayId: s.promptpay_id ?? "",
      payeeName: s.payee_name ?? "",
      hasQrImage: Boolean(s.qr_image_path),
      defaultTimezone: defaultEventTimeZone(),
    };
  });

  app.post("/api/host/settings/qr", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const uploaded = await readMultipartFile(req);
    if (!uploaded) return reply.code(400).send({ error: "QR image file required" });
    const rel = await saveUpload("qr", uploaded.filename, uploaded.buffer, "host-qr");
    await pool.query(`UPDATE host_settings SET qr_image_path = $1, updated_at = now() WHERE id = 1`, [rel]);
    return { ok: true, hasQrImage: true };
  });

  app.get("/api/host/settings/qr", async (_req, reply) => {
    const s = await getHostSettings();
    if (!s.qr_image_path) return reply.code(404).send({ error: "No QR image" });
    const buf = await readDataFile(s.qr_image_path);
    return reply.type(contentTypeFor(s.qr_image_path)).send(buf);
  });

  app.get("/api/events/:code/payment-qr-image", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const s = await getHostSettings();
    if (!s.qr_image_path) return reply.code(404).send({ error: "No QR image" });
    const buf = await readDataFile(s.qr_image_path);
    return reply.type(contentTypeFor(s.qr_image_path)).send(buf);
  });

  app.post("/api/host/events/:code/items/:itemId/voucher", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const { code, itemId } = req.params as { code: string; itemId: string };
    const event = await getEventByCode(codeOf(code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    if (!isUuid(itemId)) return reply.code(404).send({ error: "Item not found" });
    const itemRes = await pool.query("SELECT id, kind FROM items WHERE id = $1 AND event_id = $2", [itemId, event.id]);
    if (!itemRes.rows[0]) return reply.code(404).send({ error: "Item not found" });
    if (itemRes.rows[0].kind === "physical") return reply.code(400).send({ error: "Physical items have no voucher PDF" });
    const uploaded = await readMultipartFile(req);
    if (!uploaded) return reply.code(400).send({ error: "PDF voucher required" });
    if (!uploaded.filename.toLowerCase().endsWith(".pdf") && uploaded.mimetype !== "application/pdf") {
      return reply.code(400).send({ error: "Voucher must be a PDF" });
    }
    const rel = await saveUpload("vouchers", uploaded.filename, uploaded.buffer, itemId);
    await pool.query("UPDATE items SET voucher_pdf_path = $1 WHERE id = $2", [rel, itemId]);
    return { ok: true, itemId, voucherPdfPath: rel };
  });

  app.get("/api/host/events/:code/invoices", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    if (auctionStatus(event.starts_at, event.ends_at) !== "closed") {
      return {
        event: { id: event.id, code: event.code, title: event.title },
        invoices: [],
        summary: null,
        message: "Invoices are created when the auction closes",
      };
    }
    const list = await listEventInvoices(event.id);
    const invoices = list.map(({ invoice, lines }) => ({
      id: invoice.id,
      guestId: invoice.guest_id,
      guestName: invoice.guest_name,
      guestEmail: invoice.guest_email,
      guestPhone: invoice.guest_phone,
      total: money(invoice.total),
      status: invoice.status,
      paymentMethod: invoice.payment_method ?? null,
      paidBy: invoice.paid_by ?? null,
      hasPayslip: Boolean(invoice.payslip_path),
      paidAt: invoice.paid_at ? new Date(invoice.paid_at).toISOString() : null,
      vouchersEmailedAt: invoice.vouchers_emailed_at
        ? new Date(invoice.vouchers_emailed_at).toISOString()
        : null,
      lines: lines.map((l) => ({
        itemId: l.item_id,
        title: l.title,
        description: l.description,
        amount: money(l.amount),
        kind: l.kind,
        hasVoucher: Boolean(l.voucher_pdf_path),
        sponsorName: l.sponsor_name,
        handedOverAt: l.handed_over_at ? new Date(l.handed_over_at).toISOString() : null,
      })),
    }));
    const allLines = invoices.flatMap((i) => i.lines);
    const summary = {
      invoices: invoices.length,
      paid: invoices.filter((i) => i.status === "paid").length,
      totalAmount: money(invoices.reduce((s, i) => s + i.total, 0)),
      paidAmount: money(invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0)),
      items: allLines.length,
      handedOver: allLines.filter((l) => l.handedOverAt).length,
    };
    return { event: { id: event.id, code: event.code, title: event.title }, invoices, summary };
  });

  app.get("/api/host/invoices/:invoiceId/payslip", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const invoiceId = (req.params as { invoiceId: string }).invoiceId;
    if (!isUuid(invoiceId)) return reply.code(404).send({ error: "Invoice not found" });
    const { rows } = await pool.query("SELECT payslip_path FROM invoices WHERE id = $1", [invoiceId]);
    const path = rows[0]?.payslip_path as string | undefined;
    if (!path) return reply.code(404).send({ error: "No payslip uploaded" });
    const buf = await readDataFile(path);
    return reply.type(contentTypeFor(path)).send(buf);
  });

  const confirmSchema = z.object({
    method: z.enum(["cash", "bank_transfer", "promptpay"]).optional().default("promptpay"),
    confirmedWithoutSlip: z.boolean().optional().default(false),
  });

  /** Payment desk: mark paid (method), then email vouchers / pickup note when possible. */
  app.post("/api/host/invoices/:invoiceId/confirm-payment", async (req, reply) => {
    let host: HostUser;
    try { host = (await requireHost(req)) as HostUser; } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const invoiceId = (req.params as { invoiceId: string }).invoiceId;
    if (!isUuid(invoiceId)) return reply.code(404).send({ error: "Invoice not found" });
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const paid = await markInvoicePaid(invoiceId, { ...parsed.data, hostEmail: host.email });
    const email = await sendWinnerEmail(invoiceId);
    return { ok: true, alreadyPaid: paid.alreadyPaid, ...email };
  });

  /** (Re)send the winner email, e.g. after adding a missing voucher PDF or the guest's email. */
  app.post("/api/host/invoices/:invoiceId/send-email", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const invoiceId = (req.params as { invoiceId: string }).invoiceId;
    if (!isUuid(invoiceId)) return reply.code(404).send({ error: "Invoice not found" });
    return { ok: true, ...(await sendWinnerEmail(invoiceId, { force: true })) };
  });

  const handoverSchema = z.object({ handedOver: z.boolean() });

  app.post("/api/host/invoices/:invoiceId/lines/:itemId/handover", async (req, reply) => {
    let host: HostUser;
    try { host = (await requireHost(req)) as HostUser; } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const { invoiceId, itemId } = req.params as { invoiceId: string; itemId: string };
    if (!isUuid(invoiceId) || !isUuid(itemId)) return reply.code(404).send({ error: "Not found" });
    const parsed = handoverSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: true, ...(await setHandedOver(invoiceId, itemId, parsed.data.handedOver, host.email)) };
  });

  /** Results export (one row per lot) as CSV or Excel. */
  app.get("/api/host/events/:code/results.:format", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const { code, format } = req.params as { code: string; format: string };
    if (format !== "csv" && format !== "xlsx") return reply.code(404).send({ error: "Use .csv or .xlsx" });
    const event = await getEventByCode(codeOf(code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const results = await eventResults(event.id);
    // ?notes=1 adds the host-only Notes column (may contain names); off by default so shared exports don't leak it.
    const q = (req.query ?? {}) as { notes?: string };
    const opts = { includeNotes: q.notes === "1" || q.notes === "true" };
    const base = `results-${event.code}`;
    if (format === "csv") {
      return reply
        .header("Content-Disposition", `attachment; filename="${base}.csv"`)
        .type("text/csv; charset=utf-8")
        .send(resultsCsv(results, opts));
    }
    return reply
      .header("Content-Disposition", `attachment; filename="${base}.xlsx"`)
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(await resultsXlsx(results, event.title, opts));
  });
}
