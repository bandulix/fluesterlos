import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";
import { dedupeDescription, summarize, type ImportRow } from "../src/itemImport.js";

let app: FastifyInstance;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

async function live(code: string) {
  return (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
}

describe("'Raised so far' counts only items with bids", () => {
  it("ignores starting bids of unbid items and includes buy-now sales", async () => {
    const cookie = await hostCookie(app);
    const ev = await createOpenEvent(app, cookie, [
      { title: "Bid on", startingBid: 1000, minIncrement: 100 },
      { title: "Fixed", startingBid: 3000, minIncrement: 100, buyNow: 3100 },
      { title: "Nobody wants me", startingBid: 50000, minIncrement: 1000 },
      { title: "Me neither", startingBid: 7000, minIncrement: 500 },
    ]);
    // Fixed-price lot: buy-now == starting bid (allowed via add/edit and import).
    await pool.query("UPDATE items SET buy_now = starting_bid WHERE id = $1", [ev.items[1].id]);
    const before = await live(ev.code);
    expect(before.stats.totalHighBids).toBe(0);
    expect(before.stats.itemsWithBids).toBe(0);

    const a = await joinGuest(app, ev.code, ph(1));
    const b = await joinGuest(app, ev.code, ph(2));
    expect((await bid(app, ev.code, a.token, ev.items[0].id, 1000)).statusCode).toBe(200);
    expect((await bid(app, ev.code, b.token, ev.items[0].id, 1200)).statusCode).toBe(200);
    expect((await bid(app, ev.code, a.token, ev.items[1].id, 3000)).statusCode).toBe(200);
    const after = await live(ev.code);
    expect(after.stats.totalHighBids).toBe(1200 + 3000);
    expect(after.stats.itemsWithBids).toBe(2);
    expect(after.stats.itemCount).toBe(4);
    expect(after.items[1]).toMatchObject({ soldViaBuyNow: true, highBid: 3000 });
    // The big-screen feed knows which item each bid was on (hot items).
    expect(after.recentBids[0].itemId).toBe(ev.items[1].id);
  });
});

describe("fixed-price purchase can be undone within the grace window", () => {
  it("reopens the lot for everybody", async () => {
    const cookie = await hostCookie(app);
    const ev = await createOpenEvent(app, cookie, [{ title: "Fixed", startingBid: 3000, minIncrement: 100, buyNow: 3100 }]);
    await pool.query("UPDATE items SET buy_now = starting_bid WHERE id = $1", [ev.items[0].id]);
    const a = await joinGuest(app, ev.code, ph(1));
    const res = await bid(app, ev.code, a.token, ev.items[0].id, 3000);
    expect(res.statusCode).toBe(200);
    expect(res.json().undoSeconds).toBeGreaterThan(0);
    expect((await live(ev.code)).items[0].soldViaBuyNow).toBe(true);
    const undo = await app.inject({
      method: "DELETE",
      url: `/api/events/${ev.code}/bids/${res.json().bidId}`,
      headers: { "x-guest-token": a.token },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().live.items[0]).toMatchObject({ soldViaBuyNow: false, bidCount: 0 });
    expect(undo.json().live.stats.totalHighBids).toBe(0);
    // And somebody else can buy it now.
    const b = await joinGuest(app, ev.code, ph(2));
    expect((await bid(app, ev.code, b.token, ev.items[0].id, 3000)).statusCode).toBe(200);
  });
});

describe("import: description dedupe and rows to check", () => {
  it("strips a first line or leading phrase that repeats the title (accents, case, punctuation)", () => {
    expect(dedupeDescription("Spa Day for Two", "Spa Day for Two – full day incl. lunch\nValid weekdays")).toBe("full day incl. lunch\nValid weekdays");
    expect(dedupeDescription("Café Voucher", "CAFE voucher: two coffees")).toBe("two coffees");
    expect(dedupeDescription("Dinner", "Dinner\nfor two")).toBe("for two");
    expect(dedupeDescription("Spa", "Spacious room")).toBe("Spacious room");
    expect(dedupeDescription("Watch", "A nice watch")).toBe("A nice watch");
  });

  it("counts rows (not warnings), matching the 'only rows to check' filter", () => {
    const row = (issues: Array<"info" | "warning" | "error">) =>
      ({ skip: false, quantity: 1, issues: issues.map((level) => ({ level, message: level })) }) as unknown as ImportRow;
    const s = summarize([row(["warning", "warning"]), row(["warning", "info"]), row(["info"]), row([])]);
    expect(s.warnings).toBe(3);
    expect(s.rowsToCheck).toBe(2);
  });
});
