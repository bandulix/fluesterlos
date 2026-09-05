import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import { auctionStatus, money } from "./auction.js";
import { getGuestInvoice } from "./invoices.js";
import { promptPayPayload } from "./promptpay.js";
import { saveUpload } from "./storage.js";
import { guestFromRequest } from "./guestAuth.js";
import { getHostSettings } from "./invoiceHostRoutes.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date };

async function readMultipartFile(req: import("fastify").FastifyRequest) {
  const file = await req.file();
  if (!file) return null;
  const buffer = await file.toBuffer();
  return { filename: file.filename, mimetype: file.mimetype, buffer };
}

export function registerInvoiceGuestRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
  },
) {
  const { codeOf, getEventByCode } = deps;

  app.get("/api/events/:code/invoice", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) {
      return reply.code(401).send({ error: "Join the event first" });
    }
    const status = auctionStatus(event.starts_at, event.ends_at);
    const data = await getGuestInvoice(event.id, guest.id);
    if (!data) {
      return {
        event: { id: event.id, code: event.code, title: event.title, status },
        invoice: null,
        message: "No winning bids for you yet",
      };
    }
    const settings = await getHostSettings();
    let promptpayPayloadStr: string | null = null;
    const total = money(data.invoice.total);
    if (settings.promptpay_id) {
      try { promptpayPayloadStr = promptPayPayload(settings.promptpay_id, total); }
      catch { promptpayPayloadStr = null; }
    }
    return {
      event: { id: event.id, code: event.code, title: event.title, status },
      invoice: {
        id: data.invoice.id,
        total,
        status: data.invoice.status,
        hasPayslip: Boolean(data.invoice.payslip_path),
        paidAt: data.invoice.paid_at ? new Date(data.invoice.paid_at).toISOString() : null,
        lines: data.lines.map((l: { item_id: string; title: string; description: string; amount: number | string }) => ({
          itemId: l.item_id,
          title: l.title,
          description: l.description,
          amount: money(l.amount),
        })),
      },
      payment: {
        payeeName: settings.payee_name ?? "",
        promptpayId: settings.promptpay_id ?? "",
        promptpayPayload: promptpayPayloadStr,
        hasHostQrImage: Boolean(settings.qr_image_path),
        hostQrImageUrl: settings.qr_image_path
          ? `/api/events/${event.code}/payment-qr-image`
          : null,
      },
    };
  });

  app.post("/api/events/:code/invoice/payslip", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) {
      return reply.code(401).send({ error: "Join the event first" });
    }
    const data = await getGuestInvoice(event.id, guest.id);
    if (!data) return reply.code(404).send({ error: "No invoice for this guest" });
    if (data.invoice.status === "paid") {
      return reply.code(400).send({ error: "Invoice already marked paid" });
    }
    const uploaded = await readMultipartFile(req);
    if (!uploaded) return reply.code(400).send({ error: "Payslip file required" });
    const rel = await saveUpload("payslips", uploaded.filename, uploaded.buffer, data.invoice.id);
    await pool.query(
      `UPDATE invoices SET payslip_path = $1, status = 'payslip_uploaded' WHERE id = $2 AND status != 'paid'`,
      [rel, data.invoice.id],
    );
    return { ok: true, status: "payslip_uploaded" };
  });
}
