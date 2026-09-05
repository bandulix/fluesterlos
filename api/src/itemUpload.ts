import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import { publish } from "./sse.js";
import { saveUpload } from "./storage.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date };
type LiveBuilder = (eventId: string, code: string) => Promise<unknown>;

async function readParts(req: import("fastify").FastifyRequest) {
  const fields: Record<string, string> = {};
  const files: Array<{ fieldname: string; filename: string; mimetype: string; buffer: Buffer }> = [];
  for await (const part of req.parts()) {
    if (part.type === "file") {
      files.push({
        fieldname: part.fieldname,
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      });
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, files };
}

export function registerItemUploadRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    buildLivePayload: LiveBuilder;
    requireHost: (req: import("fastify").FastifyRequest) => Promise<unknown>;
  },
) {
  const { codeOf, getEventByCode, buildLivePayload, requireHost } = deps;

  app.post("/api/host/events/:code/items", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    if (!req.isMultipart?.()) {
      return reply.code(400).send({
        error: "multipart required: title, startingBid, minIncrement + voucherPdf",
      });
    }
    const { fields, files } = await readParts(req);
    const title = (fields.title || "").trim();
    const description = fields.description || "";
    const photoUrl = (fields.photoUrl || "").trim() || null;
    const startingBid = Number(fields.startingBid);
    const minIncrement = Number(fields.minIncrement);
    const buyNow = fields.buyNow?.trim() ? Number(fields.buyNow) : null;
    const pdf = files.find(
      (f) =>
        f.fieldname === "voucherPdf" ||
        f.mimetype === "application/pdf" ||
        f.filename.toLowerCase().endsWith(".pdf"),
    );
    if (!title || !(startingBid > 0) || !(minIncrement > 0)) {
      return reply.code(400).send({ error: "title, startingBid, and minIncrement are required" });
    }
    if (!pdf) {
      return reply.code(400).send({ error: "voucher PDF is required (field voucherPdf)" });
    }

    const sortRes = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM items WHERE event_id = $1",
      [event.id],
    );
    const ins = await pool.query(
      `INSERT INTO items
        (event_id, title, description, photo_url, starting_bid, min_increment, buy_now, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [event.id, title, description, photoUrl, startingBid, minIncrement, buyNow, sortRes.rows[0].n],
    );
    const itemId = ins.rows[0].id as string;
    const voucherPath = await saveUpload("vouchers", pdf.filename, pdf.buffer, itemId);
    await pool.query("UPDATE items SET voucher_pdf_path = $1 WHERE id = $2", [voucherPath, itemId]);
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return live;
  });
}
