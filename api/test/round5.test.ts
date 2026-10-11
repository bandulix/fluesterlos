import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, multipart, ph, pool } from "./helpers.js";
import { buildLargeWorkbook } from "./fixtures/importWorkbook.js";
import { dedupeDescription, tidyDescription } from "../src/itemImport.js";

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

describe("undo window", () => {
  it("a normal bid offers 5 s, a buy-now / fixed-price purchase 8 s", async () => {
    const ev = await createOpenEvent(app, cookie, [
      { title: "Fixed", startingBid: 3000, minIncrement: 100, buyNow: 3100 },
      { title: "Normal", startingBid: 1000, minIncrement: 100 },
    ]);
    await pool.query("UPDATE items SET buy_now = starting_bid WHERE id = $1", [ev.items[0].id]);
    const g = await joinGuest(app, ev.code, ph(1));
    const normal = await bid(app, ev.code, g.token, ev.items[1].id, 1000);
    expect(normal.json()).toMatchObject({ buyNow: false, undoSeconds: 5 });
    const bought = await bid(app, ev.code, g.token, ev.items[0].id, 3000);
    expect(bought.json()).toMatchObject({ buyNow: true, undoSeconds: 8 });
    // Still undoable after the visible 8 s window has nearly passed (server grace covers latency).
    await pool.query("UPDATE bids SET created_at = now() - interval '9 seconds' WHERE id = $1", [bought.json().bidId]);
    const undo = await app.inject({ method: "DELETE", url: `/api/events/${ev.code}/bids/${bought.json().bidId}`, headers: { "x-guest-token": g.token } });
    expect(undo.statusCode).toBe(200);
  });
});

describe("import: stray quotes in descriptions", () => {
  it("a quoted one-line lot name leaves no '\"' description behind", async () => {
    expect(dedupeDescription('Chocolate Set "M&Ms and Skittles galore"', 'Chocolate Set "M&Ms and Skittles galore"')).toBe("");
    expect(tidyDescription('"')).toBe("");
    expect(tidyDescription('"Relax all day"')).toBe("Relax all day");
    const ev = await createOpenEvent(app, cookie, []);
    const mp = multipart({}, [{ field: "file", filename: "big.xlsx", type: "application/octet-stream", content: await buildLargeWorkbook() }]);
    const res = await app.inject({ method: "POST", url: `/api/host/events/${ev.code}/import`, headers: { cookie, "content-type": mp.contentType }, payload: mp.payload });
    const fixed = res.json().rows.filter((r: { fixedPrice: boolean }) => r.fixedPrice);
    expect(fixed.map((r: { title: string; description: string }) => [r.title, r.description])).toEqual([
      ['Candy Set "Sweet galore 47"', ""],
      ['Candy Set "Sweet galore 48"', ""],
    ]);
  });
});
