import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus, money } from "./auction.js";
import { publish, subscribe } from "./sse.js";

type EventRow = { id: string; code: string; title: string; starts_at: Date; ends_at: Date };
type LiveBuilder = (eventId: string, code: string) => Promise<unknown>;

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

const addItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(""),
  photoUrl: z.string().url().optional().nullable(),
  startingBid: z.number().positive(),
  minIncrement: z.number().positive(),
  buyNow: z.number().positive().optional().nullable(),
});

app.post("/api/host/events/:code/items", async (req, reply) => {
  try { await requireHost(req); } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const code = codeOf((req.params as { code: string }).code);
  const event = await getEventByCode(code);
  if (!event) return reply.code(404).send({ error: "Event not found" });
  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const it = parsed.data;
  const sortRes = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM items WHERE event_id = $1",
    [event.id],
  );
  await pool.query(
    `INSERT INTO items
      (event_id, title, description, photo_url, starting_bid, min_increment, buy_now, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [event.id, it.title, it.description ?? "", it.photoUrl ?? null, it.startingBid, it.minIncrement, it.buyNow ?? null, sortRes.rows[0].n],
  );
  const live = await buildLivePayload(event.id, event.code);
  publish(event.code, "update", live);
  return live;
});

app.get("/api/events/:code", async (req, reply) => {
  const code = codeOf((req.params as { code: string }).code);
  const event = await getEventByCode(code);
  if (!event) return reply.code(404).send({ error: "Event not found" });
  const live = await buildLivePayload(event.id, event.code);
  return live;
});

const joinSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
});

app.post("/api/events/:code/join", async (req, reply) => {
  const code = codeOf((req.params as { code: string }).code);
  const event = await getEventByCode(code);
  if (!event) return reply.code(404).send({ error: "Event not found" });
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();
  const existing = await pool.query(
    "SELECT * FROM guests WHERE event_id = $1 AND lower(email) = $2",
    [event.id, email],
  );
  let guest = existing.rows[0];
  if (guest) {
    await pool.query("UPDATE guests SET name = $1 WHERE id = $2", [name, guest.id]);
    guest = { ...guest, name };
  } else {
    const token = nanoid(24);
    const ins = await pool.query(
      `INSERT INTO guests (event_id, name, email, token)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [event.id, name, email, token],
    );
    guest = ins.rows[0];
  }
  reply.setCookie("fl_guest", guest.token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
  const live = await buildLivePayload(event.id, event.code);
  publish(event.code, "update", live);
  return { guest: { id: guest.id, name: guest.name, email: guest.email, token: guest.token }, live };
});

async function guestFromRequest(req: {
  headers: Record<string, unknown>;
  cookies?: Record<string, string>;
}) {
  const header = String(req.headers["x-guest-token"] ?? "");
  const cookieToken = req.cookies?.fl_guest ?? "";
  const token = header || cookieToken;
  if (!token) return null;
  const { rows } = await pool.query("SELECT * FROM guests WHERE token = $1", [token]);
  return rows[0] as
    | { id: string; event_id: string; name: string; email: string; token: string }
    | undefined;
}

app.get("/api/events/:code/me", async (req, reply) => {
  const code = codeOf((req.params as { code: string }).code);
  const event = await getEventByCode(code);
  if (!event) return reply.code(404).send({ error: "Event not found" });
  const guest = await guestFromRequest(req as never);
  if (!guest || guest.event_id !== event.id) {
    return { guest: null };
  }
  return { guest: { id: guest.id, name: guest.name, email: guest.email, token: guest.token } };
});

const bidSchema = z.object({
  itemId: z.string().uuid(),
  amount: z.number().positive(),
});

app.post("/api/events/:code/bids", async (req, reply) => {
  const code = codeOf((req.params as { code: string }).code);
  const event = await getEventByCode(code);
  if (!event) return reply.code(404).send({ error: "Event not found" });
  const status = auctionStatus(event.starts_at, event.ends_at);
  if (status !== "open") {
    return reply.code(400).send({ error: status === "scheduled" ? "Auction has not started" : "Auction is closed" });
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
    const amount = money(parsed.data.amount);
    const buyNow = item.buy_now == null ? null : money(item.buy_now);
    const minNext = bidCount === 0 ? money(item.starting_bid) : money(currentHigh + Number(item.min_increment));
    if (!(buyNow != null && amount >= buyNow) && amount < minNext) {
      await client.query("ROLLBACK");
      return reply.code(400).send({
        error: "Bid too low",
        currentHigh,
        minNext,
        outbid: true,
      });
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
    return { ok: true, amount, currentHigh: amount, live };
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
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": String(req.headers.origin ?? "*"),
    "Access-Control-Allow-Credentials": "true",
  });

  const client = {
    write: (chunk: string) => { reply.raw.write(chunk); },
    close: () => { try { reply.raw.end(); } catch { /* */ } },
  };
  const unsub = subscribe(event.code, client);

  const live = await buildLivePayload(event.id, event.code);
  client.write(`event: update
data: ${JSON.stringify(live)}

`);

  const heartbeat = setInterval(() => {
    try { client.write(`: ping ${Date.now()}

`); } catch { /* */ }
  }, 15000);

  const refresh = setInterval(async () => {
    try {
      const next = await buildLivePayload(event.id, event.code);
      client.write(`event: update
data: ${JSON.stringify(next)}

`);
    } catch { /* */ }
  }, 5000);

  req.raw.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(refresh);
    unsub();
  });
});

}
