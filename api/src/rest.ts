import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus, money } from "./auction.js";
import { publish, subscribe } from "./sse.js";
import { contentTypeFor, readDataFile, saveUpload } from "./storage.js";
import {
  guestFromRequest,
  joinGuest,
  leaderKey,
  pendingLoginRequests,
  setGuestEmail,
  setGuestName,
  hasChosenName,
  tokenFromRequest,
  upsertGuest,
  verifyGuestCode,
} from "./guestAuth.js";
import { upsertSponsor } from "./sponsors.js";
import { ensureDeviceId, rememberDevice } from "./devices.js";
import { isAllowedOrigin, rateLimitFor } from "./security.js";
import { cookieSecure } from "./hostAuth.js";

/** Seconds the guest app offers "Undo" after a bid. */
export const BID_UNDO_SECONDS = 5;
/** Server-side grace (covers network latency on top of the visible undo window). */
const BID_UNDO_GRACE_SECONDS = 15;

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date; currency?: string };
type LiveBuilder = (eventId: string, code: string) => Promise<unknown>;

const PUBLIC_URL = () => process.env.PUBLIC_URL ?? "http://localhost:8080";

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

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isImageUpload(file: { filename: string; mimetype: string }) {
  const mime = (file.mimetype || "").toLowerCase();
  if (IMAGE_MIME.has(mime)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.filename || "");
}

function guestDto(g: { id: string; name: string; email: string | null; phone: string | null; token: string; guest_no?: number | null }) {
  return { id: g.id, name: g.name, nameSet: hasChosenName(g), guestNo: g.guest_no ?? null, email: g.email, phone: g.phone, token: g.token };
}

export function registerRestRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    buildLivePayload: LiveBuilder;
    requireHost: (req: import("fastify").FastifyRequest) => Promise<unknown>;
  },
) {
  const { codeOf, getEventByCode, buildLivePayload, requireHost } = deps;

  /**
   * Multipart add-item. Fields: title, startingBid, minIncrement, optional description, buyNow,
   * kind ("voucher" | "physical", default voucher), sponsorName or sponsorId.
   * Files: voucherPdf (optional — can be attached later), photo, sponsorLogo.
   */
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
        error: "multipart required: title, startingBid, minIncrement (+ optional voucherPdf, photo, sponsorLogo)",
      });
    }
    const { fields, files } = await readParts(req);
    const title = (fields.title || "").trim();
    const description = fields.description || "";
    const startingBid = Number(fields.startingBid);
    const minIncrement = Number(fields.minIncrement);
    const buyNow = fields.buyNow?.trim() ? Number(fields.buyNow) : null;
    const kind = (fields.kind || "voucher").trim().toLowerCase();
    const pdf = files.find(
      (f) =>
        f.fieldname === "voucherPdf" ||
        (f.fieldname !== "photo" && f.fieldname !== "sponsorLogo" &&
          (f.mimetype === "application/pdf" || f.filename.toLowerCase().endsWith(".pdf"))),
    );
    const logo = files.find((f) => f.fieldname === "sponsorLogo");
    const photo = files.find(
      (f) => f !== pdf && f !== logo && (f.fieldname === "photo" || isImageUpload(f)),
    );
    if (!title || !(startingBid > 0) || !(minIncrement > 0)) {
      return reply.code(400).send({ error: "title, startingBid, and minIncrement are required" });
    }
    if (kind !== "voucher" && kind !== "physical") {
      return reply.code(400).send({ error: "kind must be voucher or physical" });
    }
    if (buyNow != null && !(buyNow > startingBid)) {
      return reply.code(400).send({ error: "buyNow must be greater than startingBid" });
    }
    if (photo && !isImageUpload(photo)) {
      return reply.code(400).send({ error: "photo must be jpg, png, webp, or gif" });
    }
    if (pdf && kind === "physical") {
      return reply.code(400).send({ error: "physical items have no voucher PDF" });
    }

    let sponsorId: string | null = null;
    if (fields.sponsorId?.trim()) {
      const s = await pool.query("SELECT id FROM sponsors WHERE id::text = $1", [fields.sponsorId.trim()]);
      if (!s.rows[0]) return reply.code(400).send({ error: "Unknown sponsor" });
      sponsorId = s.rows[0].id;
    } else if (fields.sponsorName?.trim()) {
      sponsorId = (await upsertSponsor(fields.sponsorName, logo ?? null)).id;
    } else if (logo) {
      return reply.code(400).send({ error: "sponsorLogo needs a sponsorName" });
    }

    const sortRes = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM items WHERE event_id = $1",
      [event.id],
    );
    const ins = await pool.query(
      `INSERT INTO items
        (event_id, title, description, photo_url, starting_bid, min_increment, buy_now, sort_order, kind, sponsor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [event.id, title, description, null, startingBid, minIncrement, buyNow, sortRes.rows[0].n, kind, sponsorId],
    );
    const itemId = ins.rows[0].id as string;
    const voucherPath = pdf ? await saveUpload("vouchers", pdf.filename, pdf.buffer, itemId) : null;
    let photoPath: string | null = null;
    if (photo) {
      photoPath = await saveUpload("photos", photo.filename, photo.buffer, itemId);
    }
    await pool.query(
      "UPDATE items SET voucher_pdf_path = $1, photo_url = $2 WHERE id = $3",
      [voucherPath, photoPath, itemId],
    );
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return live;
  });

  app.get("/api/events/:code/items/:itemId/photo", async (req, reply) => {
    const { code, itemId } = req.params as { code: string; itemId: string };
    const event = await getEventByCode(codeOf(code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const itemRes = await pool.query(
      "SELECT photo_url FROM items WHERE id = $1 AND event_id = $2",
      [itemId, event.id],
    );
    const stored = itemRes.rows[0]?.photo_url as string | null | undefined;
    if (!stored) return reply.code(404).send({ error: "No photo" });
    if (/^https?:\/\//i.test(stored)) {
      return reply.redirect(stored);
    }
    const buf = await readDataFile(stored);
    return reply
      .header("Cache-Control", "public, max-age=86400")
      .type(contentTypeFor(stored))
      .send(buf);
  });

  app.get("/api/events/:code", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    return buildLivePayload(event.id, event.code);
  });

  app.get("/api/host/events/:code/guests", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.email, g.phone, g.created_at, g.claimed_at,
        (SELECT COUNT(*)::int FROM bids b WHERE b.guest_id = g.id) AS bid_count
       FROM guests g
       WHERE g.event_id = $1
       ORDER BY g.phone NULLS LAST, lower(g.email)`,
      [event.id],
    );
    return {
      guests: rows.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        joined: Boolean(g.claimed_at),
        bidCount: g.bid_count,
        createdAt: new Date(g.created_at).toISOString(),
      })),
    };
  });

  const addGuestSchema = z.object({
    phone: z.string().min(3).max(40),
    name: z.string().max(120).optional().default(""),
    email: z.string().email().max(200).optional().or(z.literal("")),
  });

  app.post("/api/host/events/:code/guests", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const parsed = addGuestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const guest = await upsertGuest(event.id, parsed.data.phone, parsed.data.name, parsed.data.email || null);
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return { guest: { id: guest.id, name: guest.name, phone: guest.phone, email: guest.email }, live };
  });

  /** Help desk: pending new-device codes. The host checks the person, then reads the code out. */
  app.get("/api/host/events/:code/login-requests", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    return { requests: await pendingLoginRequests(event.id) };
  });

  const joinSchema = z.object({
    phone: z.string().min(3).max(40),
    name: z.string().max(120).optional().default(""),
    email: z.string().email().max(200).optional().or(z.literal("")),
  });

  function setGuestCookie(reply: import("fastify").FastifyReply, token: string) {
    reply.setCookie("fl_guest", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(PUBLIC_URL()),
      maxAge: 60 * 60 * 24 * 14,
    });
  }

  app.post("/api/events/:code/join", { config: rateLimitFor("join") }, async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const deviceId = ensureDeviceId(req, reply);
    const result = await joinGuest({
      eventId: event.id,
      eventTitle: event.title,
      phone: parsed.data.phone,
      name: parsed.data.name,
      email: parsed.data.email || null,
      presentedToken: tokenFromRequest(req as never),
      deviceId,
      log: req.log,
    });
    if (result.kind === "code_sent") {
      // Existing guest on a new device: never hand out their token here.
      return reply.code(202).send({
        verificationRequired: true,
        phone: result.phone,
        delivery: result.delivery,
        maskedEmail: result.maskedEmail,
        resendInSeconds: result.resendInSeconds,
      });
    }
    const guest = result.guest;
    await rememberDevice(guest.id, deviceId);
    setGuestCookie(reply, guest.token);
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return {
      guest: guestDto(guest),
      live,
    };
  });

  const verifySchema = z.object({
    phone: z.string().min(3).max(40),
    code: z.string().regex(/^\s*\d{6}\s*$/, "6-digit code required"),
    name: z.string().max(120).optional().default(""),
  });

  app.post("/api/events/:code/join/verify", { config: rateLimitFor("verify") }, async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const guest = await verifyGuestCode({
      eventId: event.id,
      phone: parsed.data.phone,
      code: parsed.data.code,
      name: parsed.data.name,
    });
    await rememberDevice(guest.id, ensureDeviceId(req, reply));
    setGuestCookie(reply, guest.token);
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return {
      guest: guestDto(guest),
      live,
    };
  });

  app.get("/api/events/:code/me", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return { guest: null };
    // Guests already signed in (e.g. before device markers existed) get this device remembered too.
    await rememberDevice(guest.id, ensureDeviceId(req, reply));
    const bidItems = await pool.query(
      `SELECT DISTINCT b.item_id FROM bids b JOIN items i ON i.id = b.item_id
       WHERE b.guest_id = $1 AND i.event_id = $2`,
      [guest.id, event.id],
    );
    return {
      guest: guestDto(guest),
      leaderKey: leaderKey(event.id, guest.id),
      bidItemIds: bidItems.rows.map((r) => r.item_id as string),
    };
  });

  /** "Not you?" — forget this device's guest session (the guest can join again with their phone). */
  app.post("/api/events/:code/logout", async (_req, reply) => {
    reply.clearCookie("fl_guest", { path: "/" });
    return { ok: true };
  });

  const nameSchema = z.object({ name: z.string().max(120) });

  /** Guest sets their board name later (optional, inline on the bid page). */
  app.put("/api/events/:code/me/name", async (req, reply) => {
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name is too long" });
    const updated = await setGuestName(guest.id, parsed.data.name);
    // The board shows the new name right away.
    publish(event.code, "update", await buildLivePayload(event.id, event.code));
    return { guest: guestDto(updated) };
  });

  const emailSchema = z.object({ email: z.string().email().max(200) });

  /** Guest adds/changes their own email (needed to receive voucher PDFs). */
  app.put("/api/events/:code/me/email", async (req, reply) => {
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Please enter a valid email" });
    return { guest: guestDto(await setGuestEmail(guest.id, parsed.data.email)) };
  });

  /**
   * Accidental-bid protection: the bidder can take back their own bid for a few seconds,
   * but only while it is still the top bid on its item and the auction is open — so an
   * undo can never resurrect a lower bid over someone else's newer one.
   */
  app.delete("/api/events/:code/bids/:bidId", { config: rateLimitFor("bid") }, async (req, reply) => {
    const { code: rawCode, bidId } = req.params as { code: string; bidId: string };
    if (!z.string().uuid().safeParse(bidId).success) return reply.code(404).send({ error: "Bid not found" });
    const event = await getEventByCode(codeOf(rawCode));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const evNow = await client.query("SELECT starts_at, ends_at FROM events WHERE id = $1 FOR SHARE", [event.id]);
      if (auctionStatus(evNow.rows[0].starts_at, evNow.rows[0].ends_at) !== "open") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Auction is closed", tooLate: true });
      }
      const bidRes = await client.query(
        `SELECT b.id, b.item_id, b.guest_id, b.created_at FROM bids b JOIN items i ON i.id = b.item_id
          WHERE b.id = $1 AND i.event_id = $2`,
        [bidId, event.id],
      );
      const b = bidRes.rows[0];
      if (!b || b.guest_id !== guest.id) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Bid not found" });
      }
      await client.query("SELECT id FROM items WHERE id = $1 FOR UPDATE", [b.item_id]);
      const top = await client.query(
        "SELECT id FROM bids WHERE item_id = $1 ORDER BY amount DESC, created_at DESC LIMIT 1",
        [b.item_id],
      );
      const ageMs = Date.now() - new Date(b.created_at).getTime();
      if (top.rows[0]?.id !== b.id || ageMs > BID_UNDO_GRACE_SECONDS * 1000) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This bid can no longer be undone", tooLate: true });
      }
      await client.query("DELETE FROM bids WHERE id = $1", [b.id]);
      await client.query("COMMIT");
      const live = await buildLivePayload(event.id, event.code);
      publish(event.code, "update", live);
      publish(event.code, "bid-undone", { itemId: b.item_id, createdAt: new Date(b.created_at).toISOString() });
      return { ok: true, live };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  const bidSchema = z.object({
    itemId: z.string().uuid(),
    amount: z.number().positive(),
  });

  app.post("/api/events/:code/bids", { config: rateLimitFor("bid") }, async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const status = auctionStatus(event.starts_at, event.ends_at);
    if (status !== "open") {
      return reply.code(400).send({
        error: status === "scheduled" ? "Auction has not started" : "Auction is closed",
      });
    }
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) {
      return reply.code(401).send({ error: "Join the event first" });
    }
    const parsed = bidSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Share-lock the event row: "close now" / reschedule take FOR UPDATE, so no bid lands after a close.
      const evNow = await client.query("SELECT starts_at, ends_at FROM events WHERE id = $1 FOR SHARE", [event.id]);
      const statusNow = auctionStatus(evNow.rows[0].starts_at, evNow.rows[0].ends_at);
      if (statusNow !== "open") {
        await client.query("ROLLBACK");
        return reply.code(400).send({
          error: statusNow === "scheduled" ? "Auction has not started" : "Auction is closed",
        });
      }
      const itemRes = await client.query(
        "SELECT * FROM items WHERE id = $1 AND event_id = $2 FOR UPDATE",
        [parsed.data.itemId, event.id],
      );
      const item = itemRes.rows[0];
      if (!item) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Item not found" });
      }
      const highRes = await client.query(
        "SELECT COALESCE(MAX(amount), $1) AS high FROM bids WHERE item_id = $2",
        [item.starting_bid, item.id],
      );
      const bidCountRes = await client.query(
        "SELECT COUNT(*)::int AS c FROM bids WHERE item_id = $1",
        [item.id],
      );
      const currentHigh = money(highRes.rows[0].high);
      const bidCount = bidCountRes.rows[0].c as number;
      const requested = money(parsed.data.amount);
      const buyNow = item.buy_now == null ? null : money(item.buy_now);
      // Once a bid reaches the buy-now price the item is sold and takes no more bids.
      if (buyNow != null && bidCount > 0 && currentHigh >= buyNow) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Item already sold (buy now)", currentHigh, sold: true });
      }
      const minNext =
        bidCount === 0
          ? money(item.starting_bid)
          : money(currentHigh + Number(item.min_increment));
      // Buy-now is only reachable while the high bid is below it (checked above), so it can
      // never record less than the current high. Anything at or above buy-now is recorded at buy-now.
      const isBuyNow = buyNow != null && requested >= buyNow;
      const amount = isBuyNow ? buyNow! : requested;
      if (!isBuyNow && amount < minNext) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Bid too low", currentHigh, minNext, outbid: true });
      }
      const ins = await client.query(
        "INSERT INTO bids (item_id, guest_id, amount) VALUES ($1,$2,$3) RETURNING *",
        [item.id, guest.id, amount],
      );
      await client.query("COMMIT");
      const live = await buildLivePayload(event.id, event.code);
      publish(event.code, "update", live);
      publish(event.code, "bid", {
        amount,
        itemId: item.id,
        itemTitle: item.title,
        guestName: guest.name,
        createdAt: new Date(ins.rows[0].created_at).toISOString(),
      });
      return { ok: true, bidId: ins.rows[0].id as string, amount, currentHigh: amount, buyNow: isBuyNow, live, undoSeconds: BID_UNDO_SECONDS };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  app.get("/api/events/:code/stream", async (req, reply) => {
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });

    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Same-origin EventSource sends no Origin; cross-origin only for CORS_ORIGINS / PUBLIC_URL.
      ...(isAllowedOrigin(origin, PUBLIC_URL())
        ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
        : {}),
    });

    const sse = {
      write: (chunk: string) => {
        reply.raw.write(chunk);
      },
      close: () => {
        try {
          reply.raw.end();
        } catch {
          /* */
        }
      },
    };
    const unsub = subscribe(event.code, sse);
    const live = await buildLivePayload(event.id, event.code);
    sse.write(`event: update\ndata: ${JSON.stringify(live)}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        sse.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* */
      }
    }, 15000);
    const refresh = setInterval(async () => {
      try {
        const next = await buildLivePayload(event.id, event.code);
        sse.write(`event: update\ndata: ${JSON.stringify(next)}\n\n`);
      } catch {
        /* */
      }
    }, 5000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      clearInterval(refresh);
      unsub();
    });
  });
}
