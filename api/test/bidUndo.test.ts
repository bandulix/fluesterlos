import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";

let app: FastifyInstance;
let code: string;
let itemId: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  const cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Watch", startingBid: 1000, minIncrement: 100 }]);
  code = ev.code;
  itemId = ev.items[0].id;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

function undo(token: string, bidId: string) {
  return app.inject({ method: "DELETE", url: `/api/events/${code}/bids/${bidId}`, headers: { "x-guest-token": token } });
}

describe("bid undo (accidental-bid protection)", () => {
  it("the bidder can take back their own top bid right away", async () => {
    const a = await joinGuest(app, code, ph(1));
    const b = await joinGuest(app, code, ph(2));
    expect((await bid(app, code, a.token, itemId, 1000)).statusCode).toBe(200);
    const res = await bid(app, code, b.token, itemId, 1500);
    expect(res.json()).toMatchObject({ ok: true, undoSeconds: 5 });
    const bidId = res.json().bidId as string;
    // Somebody else cannot undo it.
    expect((await undo(a.token, bidId)).statusCode).toBe(404);
    const ok = await undo(b.token, bidId);
    expect(ok.statusCode).toBe(200);
    const item = ok.json().live.items[0];
    expect(item).toMatchObject({ highBid: 1000, highBidder: "Guest 1", bidCount: 1 });
  });

  it("refuses once a newer bid sits on top, and after the grace window", async () => {
    const a = await joinGuest(app, code, ph(1));
    const b = await joinGuest(app, code, ph(2));
    const first = (await bid(app, code, a.token, itemId, 1000)).json().bidId as string;
    await bid(app, code, b.token, itemId, 1100);
    const late = await undo(a.token, first);
    expect(late.statusCode).toBe(409);
    expect(late.json().tooLate).toBe(true);

    const mine = (await bid(app, code, a.token, itemId, 1200)).json().bidId as string;
    await pool.query("UPDATE bids SET created_at = now() - interval '1 minute' WHERE id = $1", [mine]);
    expect((await undo(a.token, mine)).statusCode).toBe(409);
  });
});

describe("guest numbers migration", () => {
  it("renames legacy phone-tail board names to the neutral per-event number", async () => {
    const { migrate } = await import("../src/db.js");
    const a = await joinGuest(app, code, ph(1234));
    const named = await joinGuest(app, code, ph(5678), "Anna");
    await pool.query("UPDATE guests SET name = 'Guest …1234' WHERE id = $1", [a.id]);
    await migrate();
    const rows = (await pool.query("SELECT id, name, guest_no FROM guests ORDER BY guest_no")).rows;
    expect(rows.map((r) => [r.name, r.guest_no])).toEqual([
      ["Guest 1", 1],
      ["Anna", 2],
    ]);
    expect(rows[1].id).toBe(named.id);
  });
});
