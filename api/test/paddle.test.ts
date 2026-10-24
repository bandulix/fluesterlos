import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { cleanLevels, paddleAsk, paddlePopName, paddleWho, GENEROUS_GUEST } from "../src/paddle.js";
import { closeEvent, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";

let app: FastifyInstance;
let cookie: string;
let code: string;
let eventId: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 2000, minIncrement: 200 }]);
  code = ev.code;
  eventId = ev.eventId;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

function start(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/host/events/${code}/paddle`,
    headers: { cookie },
    payload: body,
  });
}

describe("paddle raise", () => {
  it("cleans levels and reads a name or a guest number", () => {
    expect(cleanLevels([2000, 50000, 20000, 50000])).toEqual({ ok: true, levels: [50000, 20000, 2000] });
    expect(cleanLevels([])).toMatchObject({ ok: false });
    expect(paddleWho("4")).toEqual({ kind: "number", guestNo: 4 });
    expect(paddleWho("Guest 12")).toEqual({ kind: "number", guestNo: 12 });
    expect(paddleWho("The Müller Family")).toEqual({ kind: "name", name: "The Müller Family" });
    expect(paddleAsk(20000)).toBe("Who raises at ฿20,000?");
    expect(paddlePopName(null)).toBe(GENEROUS_GUEST);
    expect(paddlePopName("Siam Hotels Co.")).toBe("Siam Hotels Co.");
  });

  it("takes one-tap and room pledges into the donation total, and steps the level", async () => {
    const named = await joinGuest(app, code, ph(1), "Ada Müller");
    await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/recognition`,
      headers: { "x-guest-token": named.token },
      payload: { namedPublicly: true, publicName: "The Müller Family", showAmount: false },
    });
    const quiet = await joinGuest(app, code, ph(2), "Pat");
    const started = await start({ action: "start", title: "The school fund", levels: [10000, 5000], goal: 15000 });
    expect(started.statusCode).toBe(200);
    const paddle = started.json().live.paddle;
    expect(paddle).toMatchObject({ status: "live", title: "The school fund", level: 10000, goal: 15000, raised: 0, hitGoal: false });

    const tap = await app.inject({
      method: "POST",
      url: `/api/events/${code}/paddle`,
      headers: { "x-guest-token": quiet.token },
      payload: {},
    });
    expect(tap.statusCode).toBe(200);
    expect(tap.json().amount).toBe(10000);

    const byNumber = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/paddle/pledge`,
      headers: { cookie },
      payload: { who: "Guest 1" },
    });
    expect(byNumber.statusCode).toBe(200);

    const called = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/paddle/pledge`,
      headers: { cookie },
      payload: { who: "Siam Hotels Co." },
    });
    expect(called.statusCode).toBe(200);

    const live = called.json().live;
    const names = (live.paddle.pops as Array<{ name: string; amount: number }>).map((p) => p.name);
    expect(names).toContain(GENEROUS_GUEST);
    expect(names).toContain("The Müller Family");
    expect(names).toContain("Siam Hotels Co.");
    expect(live.paddle.hitGoal).toBe(true);
    expect(live.paddle.raised).toBe(30000);
    expect(live.paddle.pledgeCount).toBe(3);
    expect(live.paddle.atLevel).toBe(3);

    const routes = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
    const list = routes.json().donationRoutes as Array<{ name: string; donationsTotal: number; channel: string }>;
    expect(list.find((r) => r.name === "Pat")).toMatchObject({ donationsTotal: 10000, channel: "mercy" });
    expect(list.find((r) => r.name === "Siam Hotels Co.")).toMatchObject({ donationsTotal: 10000, channel: "mercy" });
    expect(list.find((r) => r.name === "Ada Müller")).toMatchObject({ donationsTotal: 10000, channel: "mercy" });

    await closeEvent(eventId);
    const invoice = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": quiet.token },
    });
    expect(invoice.json().invoice.donationsTotal).toBe(10000);
    expect(invoice.json().invoice.donationPayment.channel).toBe("mercy");

    const paused = await start({ action: "pause" });
    expect(paused.json().live.paddle.status).toBe("paused");
    const blocked = await app.inject({
      method: "POST",
      url: `/api/events/${code}/paddle`,
      headers: { "x-guest-token": quiet.token },
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);

    const next = await start({ action: "next" });
    expect(next.json().live.paddle).toMatchObject({ status: "live", level: 5000, pledgeCount: 3, atLevel: 0 });
    const ended = await start({ action: "end" });
    expect(ended.json().live.paddle.status).toBe("ended");
    expect(ended.json().live.paddle.level).toBeNull();
  });
});
