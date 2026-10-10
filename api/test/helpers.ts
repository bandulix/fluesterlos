import type { FastifyInstance } from "fastify";
import { pool, migrate } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { mailbox } from "./mailbox.js";

let migrated = false;

export async function freshApp(): Promise<FastifyInstance> {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
  await pool.query(`
    TRUNCATE guest_login_codes, invoice_lines, invoices, bids, guests, items, events,
      host_sessions, host_users RESTART IDENTITY CASCADE;
    UPDATE host_settings SET promptpay_id = NULL, payee_name = NULL, qr_image_path = NULL;
  `);
  mailbox.reset();
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

export async function hostCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/host/auth/register",
    payload: { email: "host@example.org", password: "password123", bootstrapToken: "test-bootstrap-token" },
  });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.body}`);
  return cookieHeader(res.headers["set-cookie"]);
}

export type TestItem = { title: string; startingBid: number; minIncrement: number; buyNow?: number | null };

/** Creates an open auction (started a minute ago, ends in an hour). */
export async function createOpenEvent(app: FastifyInstance, cookie: string, items: TestItem[]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/host/events",
    headers: { cookie },
    payload: {
      title: "Test Gala",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      currency: "THB",
      items,
    },
  });
  if (res.statusCode !== 200) throw new Error(`create event failed: ${res.body}`);
  const live = res.json() as { event: { code: string; id: string }; items: Array<{ id: string; title: string }> };
  return { code: live.event.code, eventId: live.event.id, items: live.items };
}

export async function closeEvent(eventId: string) {
  await pool.query(
    "UPDATE events SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' WHERE id = $1",
    [eventId],
  );
}

export async function joinGuest(app: FastifyInstance, code: string, email: string, name = "") {
  const res = await app.inject({
    method: "POST",
    url: `/api/events/${code}/join`,
    payload: { email, name },
  });
  if (res.statusCode !== 200) throw new Error(`join failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { guest: { id: string; token: string } }).guest;
}

export function bid(app: FastifyInstance, code: string, token: string, itemId: string, amount: number) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/bids`,
    headers: { "x-guest-token": token },
    payload: { itemId, amount },
  });
}

export { pool, mailbox };
