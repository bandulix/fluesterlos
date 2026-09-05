import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { money } from "./auction.js";
import {
  confirmPaymentAndEmailVouchers,
  listEventInvoices,
} from "./invoices.js";
import {
  contentTypeFor,
  readDataFile,
  saveUpload,
} from "./storage.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date };

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

  app.get("/api/host/settings", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const s = await getHostSettings();
    return { promptpayId: s.promptpay_id ?? "", payeeName: s.payee_name ?? "", hasQrImage: Boolean(s.qr_image_path) };
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
    return { promptpayId: s.promptpay_id ?? "", payeeName: s.payee_name ?? "", hasQrImage: Boolean(s.qr_image_path) };
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
    const itemRes = await pool.query("SELECT id FROM items WHERE id = $1 AND event_id = $2", [itemId, event.id]);
    if (!itemRes.rows[0]) return reply.code(404).send({ error: "Item not found" });
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
    const list = await listEventInvoices(event.id);
    return {
      event: { id: event.id, code: event.code, title: event.title },
      invoices: list.map(({ invoice, lines }) => ({
        id: invoice.id,
        guestId: invoice.guest_id,
        guestName: invoice.guest_name,
        guestEmail: invoice.guest_email,
        total: money(invoice.total),
        status: invoice.status,
        hasPayslip: Boolean(invoice.payslip_path),
        paidAt: invoice.paid_at ? new Date(invoice.paid_at).toISOString() : null,
        vouchersEmailedAt: invoice.vouchers_emailed_at
          ? new Date(invoice.vouchers_emailed_at).toISOString()
          : null,
        lines: lines.map((l: { item_id: string; title: string; description: string; amount: number | string }) => ({
          itemId: l.item_id,
          title: l.title,
          description: l.description,
          amount: money(l.amount),
        })),
      })),
    };
  });

  app.get("/api/host/invoices/:invoiceId/payslip", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const invoiceId = (req.params as { invoiceId: string }).invoiceId;
    const { rows } = await pool.query("SELECT payslip_path FROM invoices WHERE id = $1", [invoiceId]);
    const path = rows[0]?.payslip_path as string | undefined;
    if (!path) return reply.code(404).send({ error: "No payslip uploaded" });
    const buf = await readDataFile(path);
    return reply.type(contentTypeFor(path)).send(buf);
  });

  app.post("/api/host/invoices/:invoiceId/confirm-payment", async (req, reply) => {
    try { await requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const invoiceId = (req.params as { invoiceId: string }).invoiceId;
    const inv = await pool.query(
      `SELECT inv.id, e.title AS event_title FROM invoices inv JOIN events e ON e.id = inv.event_id WHERE inv.id = $1`,
      [invoiceId],
    );
    if (!inv.rows[0]) return reply.code(404).send({ error: "Invoice not found" });
    try {
      const result = await confirmPaymentAndEmailVouchers(invoiceId, inv.rows[0].event_title as string);
      return { ok: true, alreadyPaid: result.alreadyPaid, emailed: "emailed" in result ? result.emailed : 0 };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });
}
