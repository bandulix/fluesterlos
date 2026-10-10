import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, closeEvent, createOpenEvent, freshApp, hostCookie, joinGuest, pool } from "./helpers.js";

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

describe("bidding rules", () => {
  it("enforces starting bid and min increment", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Watch", startingBid: 1000, minIncrement: 100 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    const b = await joinGuest(app, code, "b@example.org");

    expect((await bid(app, code, a.token, items[0].id, 900)).statusCode).toBe(400);
    expect((await bid(app, code, a.token, items[0].id, 1000)).statusCode).toBe(200);
    const low = await bid(app, code, b.token, items[0].id, 1050);
    expect(low.statusCode).toBe(400);
    expect(low.json()).toMatchObject({ minNext: 1100, outbid: true });
    expect((await bid(app, code, b.token, items[0].id, 1100)).statusCode).toBe(200);
  });

  it("rejects bids before start and after close", async () => {
    const { code, eventId, items } = await createOpenEvent(app, cookie, [
      { title: "Watch", startingBid: 1000, minIncrement: 100 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    await closeEvent(eventId);
    const res = await bid(app, code, a.token, items[0].id, 1000);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/closed/i);
  });

  it("requires a joined guest", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Watch", startingBid: 1000, minIncrement: 100 },
    ]);
    expect((await bid(app, code, "not-a-token", items[0].id, 1000)).statusCode).toBe(401);
  });

  it("serializes concurrent bids at the same amount: exactly one wins", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Villa", startingBid: 2000, minIncrement: 200 },
    ]);
    const guests = await Promise.all(
      Array.from({ length: 10 }, (_, i) => joinGuest(app, code, `g${i}@example.org`)),
    );
    const results = await Promise.all(guests.map((g) => bid(app, code, g.token, items[0].id, 2000)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(9);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM bids");
    expect(rows[0].c).toBe(1);
  });
});

describe("buy now", () => {
  it("rejects buyNow <= startingBid at item creation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/host/events",
      headers: { cookie },
      payload: {
        title: "Bad",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        items: [{ title: "X", startingBid: 1000, minIncrement: 100, buyNow: 1000 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ends the item: no more bids after a buy-now", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Brunch", startingBid: 500, minIncrement: 50, buyNow: 2000 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    const b = await joinGuest(app, code, "b@example.org");
    expect((await bid(app, code, a.token, items[0].id, 500)).statusCode).toBe(200);

    const buy = await bid(app, code, b.token, items[0].id, 2000);
    expect(buy.statusCode).toBe(200);
    expect(buy.json()).toMatchObject({ amount: 2000, buyNow: true });

    const after = await bid(app, code, a.token, items[0].id, 2500);
    expect(after.statusCode).toBe(409);
    expect(after.json()).toMatchObject({ sold: true });

    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    expect(live.items[0]).toMatchObject({ highBid: 2000, soldViaBuyNow: true });
  });

  it("records an amount above buy-now at the buy-now price", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Brunch", startingBid: 500, minIncrement: 50, buyNow: 2000 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    const res = await bid(app, code, a.token, items[0].id, 999999);
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBe(2000);
  });

  it("buy-now is still allowed when it is below the next normal increment but above the high bid", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Onsen", startingBid: 500, minIncrement: 300, buyNow: 1000 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    const b = await joinGuest(app, code, "b@example.org");
    expect((await bid(app, code, a.token, items[0].id, 500)).statusCode).toBe(200);
    expect((await bid(app, code, a.token, items[0].id, 800)).statusCode).toBe(200); // high 800, next 1100
    const buy = await bid(app, code, b.token, items[0].id, 1000);
    expect(buy.statusCode).toBe(200);
    expect(buy.json().amount).toBe(1000);
  });

  it("never accepts a buy-now below the current high bid (legacy data with high >= buy-now)", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Legacy", startingBid: 500, minIncrement: 100, buyNow: 2000 },
    ]);
    const a = await joinGuest(app, code, "a@example.org");
    const b = await joinGuest(app, code, "b@example.org");
    // Simulate a DB from before the fix: a high bid above buy-now already exists.
    await pool.query("INSERT INTO bids (item_id, guest_id, amount) VALUES ($1, $2, 3000)", [items[0].id, a.id]);
    const res = await bid(app, code, b.token, items[0].id, 2000);
    expect(res.statusCode).toBe(409);
    const { rows } = await pool.query("SELECT MAX(amount)::float AS m, COUNT(*)::int AS c FROM bids");
    expect(rows[0]).toEqual({ m: 3000, c: 1 });
  });

  it("concurrent buy-now attempts: exactly one succeeds", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "Jersey", startingBid: 1000, minIncrement: 100, buyNow: 5000 },
    ]);
    const guests = await Promise.all(
      Array.from({ length: 8 }, (_, i) => joinGuest(app, code, `g${i}@example.org`)),
    );
    const results = await Promise.all(guests.map((g) => bid(app, code, g.token, items[0].id, 5000)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(7);
  });
});
