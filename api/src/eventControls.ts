import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus, money, type AuctionStatus } from "./auction.js";
import { publish } from "./sse.js";
import { contentTypeFor, readDataFile, saveUpload } from "./storage.js";
import { isImageFile, upsertSponsor } from "./sponsors.js";
import { parseInstant } from "./eventTime.js";

type EventRow = { id: string; code: string; starts_at: Date; ends_at: Date };
type Deps = {
  codeOf: (raw: string) => string;
  getEventByCode: (code: string) => Promise<EventRow | undefined>;
  buildLivePayload: (eventId: string, code: string) => Promise<unknown>;
  requireHost: (req: FastifyRequest) => Promise<unknown>;
};

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const MAX_EXTEND_MINUTES = 24 * 60;

export type ScheduleChange = {
  startsAt?: Date;
  endsAt?: Date;
  /** End the auction right now (records who closed it). */
  closeNow?: boolean;
  /** Add minutes to the end; on a closed auction this reopens it for that many minutes from now. */
  extendMinutes?: number;
};

/**
 * Change an event's schedule under a row lock (bids take a share lock on the same row, so no bid
 * slips in after "close now"). Rules:
 * - end must be after start;
 * - a closed auction can only be reopened while no invoice is paid (paid money stays final);
 * - once there are bids the start can't move into the future (would hide the auction again).
 */
export async function rescheduleEvent(
  eventId: string,
  change: ScheduleChange,
  hostEmail: string | null,
): Promise<{ before: AuctionStatus; after: AuctionStatus }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT starts_at, ends_at FROM events WHERE id = $1 FOR UPDATE",
      [eventId],
    );
    if (!rows[0]) throw httpError(404, "Event not found");
    const now = new Date();
    let start = new Date(rows[0].starts_at);
    let end = new Date(rows[0].ends_at);
    const before = auctionStatus(start, end, now);

    if (change.closeNow) {
      if (before === "closed") throw httpError(409, "Auction is already closed");
      end = now;
      if (start > now) start = now;
    } else {
      if (change.startsAt) start = change.startsAt;
      if (change.endsAt) end = change.endsAt;
      if (change.extendMinutes) {
        // Open/scheduled: push the end out. Closed: reopen for N minutes from now.
        const base = before === "closed" ? now : end;
        end = new Date(base.getTime() + change.extendMinutes * 60_000);
      }
      if (end <= start) throw httpError(400, "End must be after start");
    }

    const after = auctionStatus(start, end, now);
    if (before === "closed" && after !== "closed") {
      const paid = await client.query(
        "SELECT COUNT(*)::int AS n FROM invoices WHERE event_id = $1 AND status = 'paid'",
        [eventId],
      );
      if (paid.rows[0].n > 0) {
        throw httpError(409, `Can't reopen: ${paid.rows[0].n} invoice(s) are already paid`);
      }
    }
    if (after === "scheduled" && before !== "scheduled") {
      const bids = await client.query(
        "SELECT 1 FROM bids b JOIN items i ON i.id = b.item_id WHERE i.event_id = $1 LIMIT 1",
        [eventId],
      );
      if (bids.rows[0]) throw httpError(409, "There are bids already; the start can't move into the future");
    }

    await client.query(
      `UPDATE events SET starts_at = $2, ends_at = $3,
         closed_early_at = CASE WHEN $4::boolean THEN now() WHEN $5::boolean THEN closed_early_at ELSE NULL END,
         closed_by = CASE WHEN $4::boolean THEN $6 WHEN $5::boolean THEN closed_by ELSE NULL END
       WHERE id = $1`,
      [eventId, start, end, Boolean(change.closeNow), after === "closed", hostEmail],
    );
    await client.query("COMMIT");
    return { before, after };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function readParts(req: FastifyRequest) {
  const fields: Record<string, string> = {};
  const files: Array<{ fieldname: string; filename: string; mimetype: string; buffer: Buffer }> = [];
  for await (const part of req.parts()) {
    if (part.type === "file") {
      files.push({ fieldname: part.fieldname, filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() });
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, files };
}

export function registerEventControlRoutes(app: FastifyInstance, deps: Deps) {
  const { codeOf, getEventByCode, buildLivePayload, requireHost } = deps;

  async function hostAndEvent(req: FastifyRequest, reply: FastifyReply) {
    let host: { email: string };
    try {
      host = (await requireHost(req)) as { email: string };
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) {
      reply.code(404).send({ error: "Event not found" });
      return null;
    }
    return { host, event };
  }

  async function publishAndReturn(event: EventRow) {
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return live;
  }

  const scheduleSchema = z.object({
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  });

  /** Edit start/end (absolute instants with offset). */
  app.put("/api/host/events/:code/schedule", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "startsAt/endsAt must be ISO times with an offset" });
    const startsAt = parsed.data.startsAt ? parseInstant(parsed.data.startsAt) : undefined;
    const endsAt = parsed.data.endsAt ? parseInstant(parsed.data.endsAt) : undefined;
    if (startsAt === null || endsAt === null) return reply.code(400).send({ error: "Invalid time" });
    await rescheduleEvent(ctx.event.id, { startsAt, endsAt }, ctx.host.email);
    return publishAndReturn(ctx.event);
  });

  app.post("/api/host/events/:code/close", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    await rescheduleEvent(ctx.event.id, { closeNow: true }, ctx.host.email);
    return publishAndReturn(ctx.event);
  });

  const extendSchema = z.object({ minutes: z.number().int().min(1).max(MAX_EXTEND_MINUTES) });

  /** Extend by N minutes; on a closed auction this reopens it (only while nothing is paid). */
  app.post("/api/host/events/:code/extend", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    const parsed = extendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `minutes must be 1–${MAX_EXTEND_MINUTES}` });
    await rescheduleEvent(ctx.event.id, { extendMinutes: parsed.data.minutes }, ctx.host.email);
    return publishAndReturn(ctx.event);
  });

  /**
   * Edit an item (multipart or JSON). Fields: title, description, startingBid, minIncrement,
   * buyNow ("" clears), kind, sponsorName ("" removes the sponsor); files: photo, sponsorLogo.
   * After bids: price fields and type are locked. After close: only title, description, sponsor, photo.
   */
  app.patch("/api/host/events/:code/items/:itemId", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    const itemId = (req.params as { itemId: string }).itemId;
    if (!isUuid(itemId)) return reply.code(404).send({ error: "Item not found" });
    const itemRes = await pool.query(
      `SELECT i.*, (SELECT COUNT(*)::int FROM bids b WHERE b.item_id = i.id) AS bid_count
       FROM items i WHERE i.id = $1 AND i.event_id = $2`,
      [itemId, ctx.event.id],
    );
    const item = itemRes.rows[0];
    if (!item) return reply.code(404).send({ error: "Item not found" });

    let fields: Record<string, string | number | null | undefined> = {};
    let files: Awaited<ReturnType<typeof readParts>>["files"] = [];
    if (req.isMultipart?.()) {
      const parts = await readParts(req);
      fields = parts.fields;
      files = parts.files;
    } else {
      fields = (req.body ?? {}) as typeof fields;
    }
    const str = (k: string) => (fields[k] === undefined || fields[k] === null ? undefined : String(fields[k]));
    const num = (k: string) => {
      const v = str(k);
      if (v === undefined) return undefined;
      if (v.trim() === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw httpError(400, `${k} must be a number`);
      return money(n);
    };

    const title = str("title")?.trim();
    if (title !== undefined && (!title || title.length > 200)) return reply.code(400).send({ error: "Title is required" });
    const description = str("description");
    const kind = str("kind")?.trim().toLowerCase();
    if (kind !== undefined && kind !== "voucher" && kind !== "physical") {
      return reply.code(400).send({ error: "kind must be voucher or physical" });
    }
    const startingBid = num("startingBid");
    const minIncrement = num("minIncrement");
    const buyNow = num("buyNow");
    if (startingBid === null || minIncrement === null) {
      return reply.code(400).send({ error: "startingBid and minIncrement are required" });
    }
    if ((startingBid !== undefined && !(startingBid > 0)) || (minIncrement !== undefined && !(minIncrement > 0))) {
      return reply.code(400).send({ error: "startingBid and minIncrement must be positive" });
    }

    const cur = {
      startingBid: money(item.starting_bid),
      minIncrement: money(item.min_increment),
      buyNow: item.buy_now == null ? null : money(item.buy_now),
      kind: item.kind as string,
    };
    const next = {
      startingBid: startingBid ?? cur.startingBid,
      minIncrement: minIncrement ?? cur.minIncrement,
      buyNow: buyNow === undefined ? cur.buyNow : buyNow,
      kind: kind ?? cur.kind,
    };
    const pricingChanged =
      next.startingBid !== cur.startingBid ||
      next.minIncrement !== cur.minIncrement ||
      next.buyNow !== cur.buyNow ||
      next.kind !== cur.kind;
    const closed = auctionStatus(ctx.event.starts_at, ctx.event.ends_at) === "closed";
    if (pricingChanged && closed) {
      return reply.code(409).send({ error: "Auction is closed: only title, description, sponsor and photo can change" });
    }
    if (pricingChanged && item.bid_count > 0) {
      return reply.code(409).send({ error: "This item has bids: prices and type can't change any more" });
    }
    if (next.buyNow != null && !(next.buyNow > next.startingBid)) {
      return reply.code(400).send({ error: "buyNow must be greater than startingBid" });
    }

    const photo = files.find((f) => f.fieldname === "photo");
    const logo = files.find((f) => f.fieldname === "sponsorLogo");
    if (photo && !isImageFile(photo)) return reply.code(400).send({ error: "photo must be jpg, png, webp, or gif" });
    let sponsorId: string | null | undefined;
    const sponsorName = str("sponsorName");
    if (sponsorName !== undefined) {
      if (sponsorName.trim()) sponsorId = (await upsertSponsor(sponsorName, logo ?? null)).id;
      else if (logo) return reply.code(400).send({ error: "sponsorLogo needs a sponsorName" });
      else sponsorId = null;
    } else if (logo) {
      return reply.code(400).send({ error: "sponsorLogo needs a sponsorName" });
    }
    const photoPath = photo ? await saveUpload("photos", photo.filename, photo.buffer, `${itemId}-${Date.now().toString(36)}`) : undefined;

    await pool.query(
      `UPDATE items SET
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         starting_bid = $4, min_increment = $5, buy_now = $6, kind = $7,
         voucher_pdf_path = CASE WHEN $7 = 'physical' THEN NULL ELSE voucher_pdf_path END,
         sponsor_id = CASE WHEN $8::boolean THEN $9::uuid ELSE sponsor_id END,
         photo_url = COALESCE($10, photo_url)
       WHERE id = $1`,
      [
        itemId,
        title ?? null,
        description ?? null,
        next.startingBid,
        next.minIncrement,
        next.buyNow,
        next.kind,
        sponsorId !== undefined,
        sponsorId ?? null,
        photoPath ?? null,
      ],
    );
    return publishAndReturn(ctx.event);
  });

  /** Delete an item that has no bids yet. */
  app.delete("/api/host/events/:code/items/:itemId", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    const itemId = (req.params as { itemId: string }).itemId;
    if (!isUuid(itemId)) return reply.code(404).send({ error: "Item not found" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const it = await client.query("SELECT id FROM items WHERE id = $1 AND event_id = $2 FOR UPDATE", [
        itemId,
        ctx.event.id,
      ]);
      if (!it.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Item not found" });
      }
      const bids = await client.query("SELECT 1 FROM bids WHERE item_id = $1 LIMIT 1", [itemId]);
      if (bids.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This item has bids and can't be deleted" });
      }
      await client.query("DELETE FROM items WHERE id = $1", [itemId]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return publishAndReturn(ctx.event);
  });

  /** Open an item's voucher PDF (to print / show at the desk for guests without email). */
  app.get("/api/host/events/:code/items/:itemId/voucher", async (req, reply) => {
    const ctx = await hostAndEvent(req, reply);
    if (!ctx) return;
    const itemId = (req.params as { itemId: string }).itemId;
    if (!isUuid(itemId)) return reply.code(404).send({ error: "Item not found" });
    const { rows } = await pool.query("SELECT voucher_pdf_path FROM items WHERE id = $1 AND event_id = $2", [
      itemId,
      ctx.event.id,
    ]);
    if (!rows[0]?.voucher_pdf_path) return reply.code(404).send({ error: "No voucher PDF" });
    const buf = await readDataFile(rows[0].voucher_pdf_path);
    return reply
      .type(contentTypeFor(rows[0].voucher_pdf_path))
      .header("Content-Disposition", "inline")
      .send(buf);
  });
}
