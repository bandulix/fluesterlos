import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus, money, parseCurrency } from "./auction.js";
import { publish } from "./sse.js";
import { registerRestRoutes } from "./rest.js";
import { registerInvoiceRoutes } from "./invoiceRoutes.js";
import { registerRateLimit, corsOriginOption, rateLimitFor } from "./security.js";
import {
  clearSession,
  countHostUsers,
  createSession,
  hostFromRequest,
  addHostUser,
  loginHost,
  listHostUsers,
  registerOwner,
  removeHostUser,
  requireHost,
  requireOwner,
} from "./hostAuth.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const BOOTSTRAP_TOKEN = process.env.BOOTSTRAP_TOKEN ?? "";
  const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:8080";

  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: process.env.TRUST_PROXY ?? "loopback,linklocal,uniquelocal",
  });

  await app.register(cors, {
    origin: corsOriginOption(PUBLIC_URL),
    credentials: true,
  });
  await registerRateLimit(app);
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 3 },
  });

  function codeOf(raw: string) {
    return raw.trim().toLowerCase();
  }

  function publicItemPhotoUrl(code: string, itemId: string, stored: string | null): string | null {
    if (!stored) return null;
    if (/^https?:\/\//i.test(stored)) return stored;
    return `/api/events/${code}/items/${itemId}/photo`;
  }

  async function getEventByCode(code: string) {
    const { rows } = await pool.query(
      "SELECT * FROM events WHERE lower(code) = lower($1)",
      [code],
    );
    return rows[0] as
      | {
          id: string;
          code: string;
          title: string;
          starts_at: Date;
          ends_at: Date;
          currency?: string;
        }
      | undefined;
  }

  async function buildLivePayload(eventId: string, code: string) {
    const event = await getEventByCode(code);
    if (!event) return null;
    const status = auctionStatus(event.starts_at, event.ends_at);
    const itemsRes = await pool.query(
      `SELECT i.*,
        COALESCE((SELECT MAX(b.amount) FROM bids b WHERE b.item_id = i.id), i.starting_bid) AS high_bid,
        (SELECT g.name FROM bids b JOIN guests g ON g.id = b.guest_id
          WHERE b.item_id = i.id ORDER BY b.amount DESC, b.created_at ASC LIMIT 1) AS high_bidder,
        (SELECT COUNT(*)::int FROM bids b WHERE b.item_id = i.id) AS bid_count
       FROM items i WHERE i.event_id = $1 ORDER BY i.sort_order, i.created_at`,
      [eventId],
    );
    const recentRes = await pool.query(
      `SELECT b.amount, b.created_at, i.title AS item_title, g.name AS guest_name
       FROM bids b
       JOIN items i ON i.id = b.item_id
       JOIN guests g ON g.id = b.guest_id
       WHERE i.event_id = $1
       ORDER BY b.created_at DESC LIMIT 20`,
      [eventId],
    );
    const guestsRes = await pool.query(
      "SELECT COUNT(*)::int AS c FROM guests WHERE event_id = $1",
      [eventId],
    );
    const items = itemsRes.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      photoUrl: publicItemPhotoUrl(code, row.id, row.photo_url),
      startingBid: money(row.starting_bid),
      minIncrement: money(row.min_increment),
      buyNow: row.buy_now == null ? null : money(row.buy_now),
      soldViaBuyNow: row.buy_now != null && row.bid_count > 0 && money(row.high_bid) >= money(row.buy_now),
      sortOrder: row.sort_order,
      highBid: money(row.high_bid),
      highBidder: row.high_bidder,
      bidCount: row.bid_count,
      hasVoucher: Boolean(row.voucher_pdf_path),
    }));
    const totalHigh = items.reduce((sum, it) => sum + it.highBid, 0);
    const totalBids = items.reduce((sum, it) => sum + it.bidCount, 0);
    return {
      event: {
        id: event.id,
        code: event.code,
        title: event.title,
        startsAt: new Date(event.starts_at).toISOString(),
        endsAt: new Date(event.ends_at).toISOString(),
        status,
        currency: parseCurrency(event.currency),
        joinUrl: `${PUBLIC_URL}/e/${event.code}`,
      },
      items,
      stats: {
        guestCount: guestsRes.rows[0].c,
        totalHighBids: money(totalHigh),
        totalBids,
        itemCount: items.length,
      },
      recentBids: recentRes.rows.map((r) => ({
        amount: money(r.amount),
        createdAt: new Date(r.created_at).toISOString(),
        itemTitle: r.item_title,
        guestName: r.guest_name,
      })),
      serverNow: new Date().toISOString(),
    };
  }

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/host/auth/status", async (req) => {
    const needsBootstrap = (await countHostUsers()) === 0;
    const host = await hostFromRequest(req);
    return {
      needsBootstrap,
      authenticated: !!host,
      email: host?.email,
      role: host?.role,
      id: host?.id,
    };
  });

  const registerSchema = z.object({
    email: z.string().email().max(200),
    password: z.string().min(8).max(200),
    bootstrapToken: z.string().min(1).max(500),
  });

  app.post("/api/host/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!BOOTSTRAP_TOKEN) {
      return reply.code(503).send({
        error: "BOOTSTRAP_TOKEN is not configured on the server",
      });
    }
    const email = parsed.data.email.trim().toLowerCase();
    try {
      const user = await registerOwner(
        email,
        parsed.data.password,
        parsed.data.bootstrapToken,
        BOOTSTRAP_TOKEN,
      );
      await createSession(user.id, reply, PUBLIC_URL);
      return { user: { id: user.id, email: user.email, role: user.role } };
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ error: (e as Error).message });
    }
  });

  const loginSchema = z.object({
    email: z.string().email().max(200),
    password: z.string().min(1).max(200),
  });

  app.post("/api/host/auth/login", { config: rateLimitFor("hostLogin") }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const user = await loginHost(
        parsed.data.email.trim().toLowerCase(),
        parsed.data.password,
      );
      await createSession(user.id, reply, PUBLIC_URL);
      return { user: { id: user.id, email: user.email, role: user.role } };
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ error: (e as Error).message });
    }
  });

  app.post("/api/host/auth/logout", async (req, reply) => {
    await clearSession(req, reply);
    return { ok: true };
  });

  app.get("/api/host/me", async (req, reply) => {
    const host = await hostFromRequest(req);
    if (!host) return reply.code(401).send({ error: "Unauthorized" });
    return { user: { id: host.id, email: host.email, role: host.role } };
  });

  app.get("/api/host/users", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return { users: await listHostUsers() };
  });

  const addHostSchema = z.object({
    email: z.string().email().max(200),
    password: z.string().min(8).max(200),
  });

  app.post("/api/host/users", async (req, reply) => {
    try {
      await requireOwner(req);
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 401;
      return reply.code(status).send({ error: (e as Error).message });
    }
    const parsed = addHostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const user = await addHostUser(parsed.data.email, parsed.data.password);
      return { user };
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/host/users/:id", async (req, reply) => {
    let actor;
    try {
      actor = await requireOwner(req);
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 401;
      return reply.code(status).send({ error: (e as Error).message });
    }
    try {
      await removeHostUser((req.params as { id: string }).id, actor.id);
      return { ok: true };
    } catch (e) {
      const status = (e as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ error: (e as Error).message });
    }
  });

  app.get("/api/host/check", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return { ok: true };
  });

  app.get("/api/host/events", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.code, e.title, e.starts_at, e.ends_at, e.created_at, e.currency,
        (SELECT COUNT(*)::int FROM items i WHERE i.event_id = e.id) AS item_count,
        (SELECT COUNT(*)::int FROM guests g WHERE g.event_id = e.id) AS guest_count
       FROM events e
       ORDER BY e.created_at DESC`,
    );
    return {
      events: rows.map((e) => ({
        id: e.id,
        code: e.code,
        title: e.title,
        startsAt: new Date(e.starts_at).toISOString(),
        endsAt: new Date(e.ends_at).toISOString(),
        createdAt: new Date(e.created_at).toISOString(),
        status: auctionStatus(e.starts_at, e.ends_at),
        currency: parseCurrency(e.currency),
        itemCount: e.item_count,
        guestCount: e.guest_count,
        joinUrl: `${PUBLIC_URL}/e/${e.code}`,
      })),
    };
  });

  const createEventSchema = z.object({
    title: z.string().min(1).max(200),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    currency: z.enum(["USD", "EUR", "THB"]).optional().default("THB"),
    items: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          description: z.string().max(5000).optional().default(""),
          photoUrl: z.string().url().optional().nullable(),
          startingBid: z.number().positive(),
          minIncrement: z.number().positive(),
          buyNow: z.number().positive().optional().nullable(),
        }),
      )
      .default([]),
  });

  app.post("/api/host/events", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (body.items.some((it) => it.buyNow != null && !(it.buyNow > it.startingBid))) {
      return reply.code(400).send({ error: "buyNow must be greater than startingBid" });
    }
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      return reply.code(400).send({ error: "endsAt must be after startsAt" });
    }
    const code = nanoid(8).toLowerCase();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ev = await client.query(
        `INSERT INTO events (code, title, starts_at, ends_at, currency)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [code, body.title, body.startsAt, body.endsAt, body.currency],
      );
      const event = ev.rows[0];
      for (let i = 0; i < body.items.length; i++) {
        const it = body.items[i];
        await client.query(
          `INSERT INTO items
            (event_id, title, description, photo_url, starting_bid, min_increment, buy_now, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            event.id,
            it.title,
            it.description ?? "",
            it.photoUrl ?? null,
            it.startingBid,
            it.minIncrement,
            it.buyNow ?? null,
            i,
          ],
        );
      }
      await client.query("COMMIT");
      return buildLivePayload(event.id, event.code);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  const patchEventSchema = z.object({
    currency: z.enum(["USD", "EUR", "THB"]).optional(),
    title: z.string().min(1).max(200).optional(),
  });

  app.patch("/api/host/events/:code", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const parsed = patchEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.currency !== undefined) {
      await pool.query("UPDATE events SET currency = $1 WHERE id = $2", [parsed.data.currency, event.id]);
    }
    if (parsed.data.title !== undefined) {
      await pool.query("UPDATE events SET title = $1 WHERE id = $2", [parsed.data.title, event.id]);
    }
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return live;
  });

  registerRestRoutes(app, { codeOf, getEventByCode, buildLivePayload, requireHost });
  registerInvoiceRoutes(app, { codeOf, getEventByCode, requireHost });

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const status = e.statusCode ?? 500;
    reply.code(status).send({ error: e.message || "Server error" });
  });

  return app;
}
