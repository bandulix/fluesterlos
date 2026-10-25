import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { planProxyBids, soCloseOffer } from "../src/proxyBid.js";
import { paddleTileAmounts } from "../src/paddle.js";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";

const at = (n: number) => n;

describe("proxy bid resolution", () => {
  it("a lone maximum bids only the starting price", () => {
    const rows = planProxyBids({
      startingBid: 1000,
      increment: 100,
      buyNow: null,
      bids: [],
      maxes: [{ guestId: "ada", max: 5000, at: at(1) }],
    });
    expect(rows).toEqual([{ guestId: "ada", amount: 1000, aheadOfTies: false }]);
  });

  it("the higher maximum leads at one increment above the other", () => {
    const rows = planProxyBids({
      startingBid: 1000,
      increment: 100,
      buyNow: null,
      bids: [],
      maxes: [
        { guestId: "ada", max: 3000, at: at(1) },
        { guestId: "ben", max: 5000, at: at(2) },
      ],
    });
    expect(rows).toEqual([
      { guestId: "ada", amount: 3000, aheadOfTies: false },
      { guestId: "ben", amount: 3100, aheadOfTies: false },
    ]);
  });

  it("an earlier maximum wins a tie at that amount", () => {
    const rows = planProxyBids({
      startingBid: 1000,
      increment: 100,
      buyNow: null,
      bids: [],
      maxes: [
        { guestId: "ben", max: 5000, at: at(2) },
        { guestId: "ada", max: 5000, at: at(1) },
      ],
    });
    expect(rows.map((r) => r.guestId)).toEqual(["ada", "ben"]);
    expect(rows.every((r) => r.amount === 5000)).toBe(true);
    expect(rows[0].aheadOfTies).toBe(true);
    expect(rows[1].aheadOfTies).toBe(false);
  });

  it("does not bid past a manual bid that is above every maximum", () => {
    const rows = planProxyBids({
      startingBid: 1000,
      increment: 100,
      buyNow: null,
      bids: [{ guestId: "clara", amount: 4000, at: at(5) }],
      maxes: [{ guestId: "ada", max: 3000, at: at(1) }],
    });
    expect(rows).toEqual([{ guestId: "ada", amount: 3000, aheadOfTies: false }]);
  });

  it("offers So close only to the second-highest bid within one increment", () => {
    const bids = [
      { guestId: "ada", amount: 1600, at: 1 },
      { guestId: "ben", amount: 1500, at: 2 },
      { guestId: "clara", amount: 1200, at: 3 },
    ];
    expect(soCloseOffer({ bids, guestId: "ben", increment: 100 })).toEqual({ amount: 1700 });
    expect(soCloseOffer({ bids, guestId: "ada", increment: 100 })).toBeNull();
    expect(soCloseOffer({ bids, guestId: "clara", increment: 100 })).toBeNull();
  });
});

describe("paddle tiles", () => {
  it("offers the called level and its neighbours", () => {
    const levels = [50000, 20000, 10000, 5000];
    expect(paddleTileAmounts(levels, 0)).toEqual([50000, 20000]);
    expect(paddleTileAmounts(levels, 1)).toEqual([50000, 20000, 10000]);
    expect(paddleTileAmounts(levels, 3)).toEqual([10000, 5000]);
  });
});

describe("proxy bids on the server", () => {
  let app: FastifyInstance;
  let cookie: string;
  let code: string;
  let itemId: string;

  beforeEach(async () => {
    await app?.close();
    app = await freshApp();
    cookie = await hostCookie(app);
    const ev = await createOpenEvent(app, cookie, [{ title: "Dinner", startingBid: 1000, minIncrement: 100 }]);
    code = ev.code;
    itemId = ev.items[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  function maxBid(token: string, amount: number) {
    return app.inject({
      method: "PUT",
      url: `/api/events/${code}/items/${itemId}/max`,
      headers: { "x-guest-token": token },
      payload: { amount },
    });
  }

  it("lets a higher max beat an earlier one, and reports the loser as outbid", async () => {
    const ada = await joinGuest(app, code, ph(1), "Ada");
    const ben = await joinGuest(app, code, ph(2), "Ben");
    const first = await maxBid(ada.token, 3000);
    expect(first.statusCode).toBe(200);
    expect(first.json().outbid).toBe(false);
    const second = await maxBid(ben.token, 5000);
    expect(second.statusCode).toBe(200);
    expect(second.json().outbid).toBe(false);
    const live = second.json().live;
    const item = live.items[0];
    expect(item.highBid).toBe(3100);
    expect(item.bidCount).toBe(3);
    const me = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ada.token } });
    expect(me.json().leaderKey).not.toBe(live.items[0].leaderKey);
    expect(me.json().maxBids).toEqual([{ itemId, amount: 3000 }]);
  });

  it("gives a tie to the maximum that was set first", async () => {
    const ada = await joinGuest(app, code, ph(3), "Ada");
    const ben = await joinGuest(app, code, ph(4), "Ben");
    await maxBid(ada.token, 5000);
    const second = await maxBid(ben.token, 5000);
    expect(second.json().outbid).toBe(true);
    const item = second.json().live.items[0];
    expect(item.highBid).toBe(5000);
    const adaMe = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ada.token } });
    expect(item.leaderKey).toBe(adaMe.json().leaderKey);
  });

  it("serialises two max bids that arrive together", async () => {
    const ada = await joinGuest(app, code, ph(5), "Ada");
    const ben = await joinGuest(app, code, ph(6), "Ben");
    const [a, b] = await Promise.all([maxBid(ada.token, 2000), maxBid(ben.token, 5000)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const live = await app.inject({ method: "GET", url: `/api/events/${code}` });
    const item = live.json().items[0];
    expect(item.highBid).toBe(2100);
    const benMe = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ben.token } });
    expect(item.leaderKey).toBe(benMe.json().leaderKey);
  });

  it("answers a manual bid with the standing maximum", async () => {
    const ada = await joinGuest(app, code, ph(7), "Ada");
    const ben = await joinGuest(app, code, ph(8), "Ben");
    await maxBid(ada.token, 5000);
    const manual = await bid(app, code, ben.token, itemId, 1100);
    expect(manual.statusCode).toBe(200);
    expect(manual.json().outbid).toBe(true);
    expect(manual.json().currentHigh).toBe(1200);
  });

  it("ranks the history and offers So close within one increment", async () => {
    const ada = await joinGuest(app, code, ph(9), "Ada");
    const ben = await joinGuest(app, code, ph(10), "Ben");
    await bid(app, code, ada.token, itemId, 1000);
    await bid(app, code, ben.token, itemId, 1100);
    const history = await app.inject({
      method: "GET",
      url: `/api/events/${code}/items/${itemId}/bids`,
      headers: { "x-guest-token": ada.token },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().bids.map((row: { name: string; rank: number }) => [row.rank, row.name])).toEqual([
      [1, "Ben"],
      [2, "Ada"],
    ]);
    expect(history.json().soClose).toEqual({ amount: 1200 });
  });

  it("watches a lot for this guest only", async () => {
    const ada = await joinGuest(app, code, ph(11), "Ada");
    const put = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/items/${itemId}/watch`,
      headers: { "x-guest-token": ada.token },
    });
    expect(put.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ada.token } });
    expect(me.json().watchedItemIds).toEqual([itemId]);
    await app.inject({
      method: "DELETE",
      url: `/api/events/${code}/items/${itemId}/watch`,
      headers: { "x-guest-token": ada.token },
    });
    const gone = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ada.token } });
    expect(gone.json().watchedItemIds).toEqual([]);
  });

  it("closes one lot without closing the auction", async () => {
    const ada = await joinGuest(app, code, ph(12), "Ada");
    const closed = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/items/${itemId}/close`,
      headers: { cookie },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().items[0].closed).toBe(true);
    expect(closed.json().event.status).toBe("open");
    const attempt = await bid(app, code, ada.token, itemId, 1000);
    expect(attempt.statusCode).toBe(409);
  });

  it("pledges a neighbouring paddle tile and rejects a level that is not called", async () => {
    const ada = await joinGuest(app, code, ph(13), "Ada");
    const started = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/paddle`,
      headers: { cookie },
      payload: { action: "start", title: "Paddle raise", levels: [10000, 5000, 2000], goal: 20000 },
    });
    expect(started.statusCode).toBe(200);
    const neighbour = await app.inject({
      method: "POST",
      url: `/api/events/${code}/paddle`,
      headers: { "x-guest-token": ada.token },
      payload: { amount: 5000 },
    });
    expect(neighbour.statusCode).toBe(200);
    expect(neighbour.json().amount).toBe(5000);
    const far = await app.inject({
      method: "POST",
      url: `/api/events/${code}/paddle`,
      headers: { "x-guest-token": ada.token },
      payload: { amount: 2000 },
    });
    expect(far.statusCode).toBe(400);
  });
});
