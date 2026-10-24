import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  fundingProgress,
  pledgeCanUndo,
  pledgeFitsCap,
  pledgeTicker,
  resolvePledge,
  roomTotals,
  PLEDGE_UNDO_SECONDS,
} from "../src/pledges.js";
import { bid, closeEvent, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";

let app: FastifyInstance;
let cookie: string;
let code: string;
let eventId: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 1000, minIncrement: 100 }]);
  code = ev.code;
  eventId = ev.eventId;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

async function addNeed(body: Record<string, unknown>) {
  const res = await app.inject({
    method: "POST",
    url: `/api/host/events/${code}/needs`,
    headers: { cookie },
    payload: {
      title: "A playground for the school",
      beneficiary: "Thai.GER charity",
      description: "Example data.",
      targetAmount: 10000,
      minPledge: 500,
      suggestedAmounts: [1000, 5000],
      ...body,
    },
  });
  return res;
}

function pledge(token: string, needId: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/pledges`,
    headers: { "x-guest-token": token },
    payload: { needId, ...body },
  });
}

describe("pledge math", () => {
  it("resolves units, minimums and caps", () => {
    expect(resolvePledge({ units: 3, unitAmount: 800, minPledge: 800 })).toEqual({ ok: true, amount: 2400, units: 3 });
    expect(resolvePledge({ amount: 400, minPledge: 500 }).ok).toBe(false);
    expect(resolvePledge({ amount: 1000.005, minPledge: 500 })).toMatchObject({ ok: true, amount: 1000.01, units: null });
    expect(pledgeFitsCap({ raised: 800, target: 1000, cap: true, amount: 300 })).toMatchObject({ ok: false, remaining: 200 });
    expect(pledgeFitsCap({ raised: 800, target: 1000, cap: false, amount: 5000 }).ok).toBe(true);
    expect(pledgeFitsCap({ raised: 1000, target: 1000, cap: true, amount: 1 })).toMatchObject({ ok: false, remaining: 0 });
  });

  it("labels funding, including past 100%, and the undo window", () => {
    expect(fundingProgress(0, 1000).label).toBe("0% funded");
    expect(fundingProgress(4200, 10000)).toMatchObject({ percent: 42, fullyFunded: false, label: "42% funded" });
    expect(fundingProgress(10000, 10000)).toMatchObject({ fullyFunded: true, overFunded: false, label: "Fully funded!" });
    expect(fundingProgress(11000, 10000)).toMatchObject({ percent: 110, overFunded: true, barPercent: 100, label: "110% funded" });
    const now = new Date("2026-10-24T12:00:10.000Z");
    expect(pledgeCanUndo("2026-10-24T12:00:00.000Z", now, PLEDGE_UNDO_SECONDS)).toBe(true);
    expect(pledgeCanUndo("2026-10-24T12:00:00.000Z", new Date("2026-10-24T12:00:10.001Z"))).toBe(false);
  });

  it("writes the big-screen ticker and keeps room totals aligned", () => {
    expect(
      pledgeTicker({ anonymous: false, guestName: "Table 7", units: 3, unitLabel: "uniform", amount: 2400 }),
    ).toBe("Table 7 funded 3 uniforms");
    expect(
      pledgeTicker({ anonymous: true, guestName: "Table 7", units: 3, unitLabel: "uniform", amount: 2400 }),
    ).toBe("A guest funded 3 uniforms");
    expect(
      pledgeTicker({ anonymous: false, guestName: "Table 7", units: null, unitLabel: null, amount: 5000 }),
    ).toBe("Table 7 pledged ฿5,000");
    expect(roomTotals(7200, [1000, 2400])).toEqual({ auction: 7200, donations: 3400, total: 10600 });
  });
});

describe("fund-a-need pledges", () => {
  it("lets many guests fund one need, and keeps every view on the same totals", async () => {
    const created = await addNeed({
      title: "School uniforms for 30 children",
      targetAmount: 24000,
      minPledge: 800,
      suggestedAmounts: [800, 2400, 8000, 24000],
      unitLabel: "uniform",
      unitAmount: 800,
    });
    expect(created.statusCode).toBe(200);
    const needId = created.json().id as string;
    const a = await joinGuest(app, code, ph(1), "Table 7");
    const b = await joinGuest(app, code, ph(2), "Table 8");
    await bid(app, code, a.token, (await app.inject({ method: "GET", url: `/api/events/${code}` })).json().items[0].id, 1000);

    const units = await pledge(a.token, needId, { units: 3, anonymous: false });
    expect(units.statusCode).toBe(200);
    expect(units.json()).toMatchObject({ amount: 2400, units: 3, undoSeconds: 10, text: "Table 7 funded 3 uniforms" });
    const custom = await pledge(b.token, needId, { amount: 5000, anonymous: true });
    expect(custom.statusCode).toBe(200);
    expect(custom.json().text).toBe("A guest pledged ฿5,000");

    const live = custom.json().live;
    expect(live.stats).toMatchObject({ totalHighBids: 1000, totalDonations: 7400, totalRaised: 8400, donorCount: 2, pledgeCount: 2 });
    expect(live.needs[0]).toMatchObject({ raised: 7400, donorCount: 2, pledgeCount: 2, label: "30.8% funded" });
    expect(live.recentPledges[0]).toMatchObject({ guestName: "A guest", anonymous: true });
    expect(JSON.stringify(live.recentPledges)).not.toContain("Table 8");

    const me = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": a.token } });
    expect(me.json().pledges).toEqual([
      expect.objectContaining({ needId, amount: 2400, units: 3, canUndo: true }),
    ]);

    const low = await pledge(a.token, needId, { amount: 100 });
    expect(low.statusCode).toBe(400);

    await closeEvent(eventId);
    const ia = await app.inject({ method: "GET", url: `/api/events/${code}/invoice`, headers: { "x-guest-token": a.token } });
    const ib = await app.inject({ method: "GET", url: `/api/events/${code}/invoice`, headers: { "x-guest-token": b.token } });
    expect(ia.json().invoice).toMatchObject({ total: 3400, lotsTotal: 1000, donationsTotal: 2400 });
    expect(ia.json().invoice.lines.map((l: { title: string }) => l.title)).toEqual(["Jersey"]);
    expect(ia.json().invoice.donations[0]).toMatchObject({ title: "School uniforms for 30 children", amount: 2400, kind: "donation" });
    expect(ib.json().invoice).toMatchObject({ total: 8000 - 3000, lotsTotal: 0, donationsTotal: 5000 });
    expect(ib.json().invoice.lines).toEqual([]);
    const hostInv = await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } });
    const grand = hostInv.json().invoices.reduce((s: number, i: { total: number }) => s + i.total, 0);
    expect(grand).toBe(live.stats.totalRaised);

    const named = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/receipt-name`,
      headers: { "x-guest-token": a.token },
      payload: { name: "Table 7 Co., Ltd." },
    });
    expect(named.statusCode).toBe(200);
    const again = await app.inject({ method: "GET", url: `/api/events/${code}/invoice`, headers: { "x-guest-token": a.token } });
    expect(again.json().invoice.receiptName).toBe("Table 7 Co., Ltd.");
  });

  it("refuses a pledge past a cap, and accepts one past 100% when uncapped", async () => {
    const capped = await addNeed({ title: "Lunches", targetAmount: 1000, minPledge: 100, suggestedAmounts: [100, 500], capAtTarget: true });
    const open = await addNeed({ title: "Playground", targetAmount: 1000, minPledge: 100, suggestedAmounts: [100], capAtTarget: false });
    const guest = await joinGuest(app, code, ph(3));
    expect((await pledge(guest.token, capped.json().id, { amount: 600 })).statusCode).toBe(200);
    const over = await pledge(guest.token, capped.json().id, { amount: 500 });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatch(/400/);
    expect((await pledge(guest.token, open.json().id, { amount: 1100 })).json().live.needs.find((n: { title: string }) => n.title === "Playground")).toMatchObject({
      raised: 1100,
      label: "110% funded",
      fullyFunded: true,
      overFunded: true,
    });
  });

  it("serialises simultaneous pledges so a cap is not exceeded", async () => {
    const created = await addNeed({ title: "Capped", targetAmount: 1000, minPledge: 100, suggestedAmounts: [100], capAtTarget: true });
    const needId = created.json().id as string;
    const a = await joinGuest(app, code, ph(4));
    const b = await joinGuest(app, code, ph(5));
    const [ra, rb] = await Promise.all([
      pledge(a.token, needId, { amount: 600 }),
      pledge(b.token, needId, { amount: 600 }),
    ]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    expect(live.needs[0].raised).toBe(600);
    expect(live.stats.totalDonations).toBe(600);
  });

  it("adds simultaneous uncapped pledges without losing either", async () => {
    const created = await addNeed({ title: "Open", targetAmount: 1000, minPledge: 100, suggestedAmounts: [100], capAtTarget: false });
    const needId = created.json().id as string;
    const a = await joinGuest(app, code, ph(6));
    const b = await joinGuest(app, code, ph(7));
    const [ra, rb] = await Promise.all([
      pledge(a.token, needId, { amount: 600 }),
      pledge(b.token, needId, { amount: 700 }),
    ]);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    const live = ra.json().live.stats.totalDonations >= 1300 ? ra.json().live : rb.json().live;
    expect(live.stats.totalDonations).toBe(1300);
    expect(live.stats.totalRaised).toBe(1300);
  });

  it("undoes a pledge inside the window and refuses it after", async () => {
    const created = await addNeed({});
    const needId = created.json().id as string;
    const a = await joinGuest(app, code, ph(8));
    const b = await joinGuest(app, code, ph(9));
    const res = await pledge(a.token, needId, { amount: 1000 });
    const pledgeId = res.json().pledgeId as string;
    expect((await app.inject({
      method: "DELETE",
      url: `/api/events/${code}/pledges/${pledgeId}`,
      headers: { "x-guest-token": b.token },
    })).statusCode).toBe(404);
    const undone = await app.inject({
      method: "DELETE",
      url: `/api/events/${code}/pledges/${pledgeId}`,
      headers: { "x-guest-token": a.token },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().live.needs[0].raised).toBe(0);

    const again = await pledge(a.token, needId, { amount: 1000 });
    await pool.query("UPDATE pledges SET created_at = now() - interval '11 seconds' WHERE id = $1", [again.json().pledgeId]);
    const late = await app.inject({
      method: "DELETE",
      url: `/api/events/${code}/pledges/${again.json().pledgeId}`,
      headers: { "x-guest-token": a.token },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().tooLate).toBe(true);
    expect(late.json().live).toBeUndefined();
  });

  it("stays open after the auction closes, unless the host sets an end or closes the need", async () => {
    const created = await addNeed({ title: "Still open" });
    const needId = created.json().id as string;
    const guest = await joinGuest(app, code, ph(10));
    await closeEvent(eventId);
    expect((await pledge(guest.token, needId, { amount: 1000 })).statusCode).toBe(200);

    const past = new Date(Date.now() - 60_000).toISOString();
    const fund = await app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/fund`,
      headers: { cookie },
      payload: { needsEndsAt: past },
    });
    expect(fund.statusCode).toBe(200);
    expect((await pledge(guest.token, needId, { amount: 1000 })).statusCode).toBe(409);

    await app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/fund`,
      headers: { cookie },
      payload: { needsEndsAt: null },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/needs/${needId}`,
      headers: { cookie },
      payload: { closed: true },
    });
    expect((await pledge(guest.token, needId, { amount: 1000 })).statusCode).toBe(409);
  });

  it("host can hide, reorder, correct and void, with an audit trail", async () => {
    const first = await addNeed({ title: "First", targetAmount: 5000, minPledge: 100, suggestedAmounts: [100] });
    const second = await addNeed({ title: "Second", targetAmount: 5000, minPledge: 100, suggestedAmounts: [100] });
    const guest = await joinGuest(app, code, ph(11), "Anna");
    const placed = await pledge(guest.token, first.json().id, { amount: 1000 });
    const pledgeId = placed.json().pledgeId as string;

    const corrected = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/pledges/${pledgeId}/correct`,
      headers: { cookie },
      payload: { amount: 1500, reason: "Guest asked to add ฿500" },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().amount).toBe(1500);

    const voided = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/pledges/${pledgeId}/void`,
      headers: { cookie },
      payload: { reason: "Entered on the wrong need" },
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().live.stats.totalDonations).toBe(0);

    const noReason = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/pledges/${pledgeId}/void`,
      headers: { cookie },
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);

    await app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/needs/${second.json().id}`,
      headers: { cookie },
      payload: { hidden: true },
    });
    const reordered = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/needs/reorder`,
      headers: { cookie },
      payload: { ids: [second.json().id, first.json().id] },
    });
    expect(reordered.statusCode).toBe(200);
    const host = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
    expect(host.json().needs.map((n: { title: string }) => n.title)).toEqual(["Second", "First"]);
    const audited = host.json().needs.find((n: { title: string }) => n.title === "First");
    expect(audited.audit.map((a: { action: string }) => a.action)).toEqual(["voided", "corrected", "created"]);
    expect(audited.pledges[0]).toMatchObject({ status: "voided", guestName: "Anna", voidReason: "Entered on the wrong need" });
    const pub = reordered.json().live.needs.map((n: { title: string }) => n.title);
    expect(pub).toEqual(["First"]);

    expect((await app.inject({ method: "DELETE", url: `/api/host/events/${code}/needs/${first.json().id}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/api/host/events/${code}/needs` })).statusCode).toBe(401);
    expect((await pledge("nope", first.json().id, { amount: 1000 })).statusCode).toBe(401);
  });

  it("seeds three labelled Thai.GER example needs and exports pledges", async () => {
    const seeded = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/needs/examples`,
      headers: { cookie },
    });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().created).toBe(3);
    const again = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/needs/examples`,
      headers: { cookie },
    });
    expect(again.json().created).toBe(0);
    const titles = seeded.json().live.needs.map((n: { title: string; example: boolean; description: string }) => n);
    expect(titles).toHaveLength(3);
    expect(titles.every((n: { example: boolean; description: string }) => n.example && n.description.startsWith("Example data"))).toBe(true);
    expect(titles.map((n: { title: string }) => n.title)).toEqual([
      "A playground for the school",
      "School uniforms for 30 children",
      "A year of lunches for one class",
    ]);

    const guest = await joinGuest(app, code, ph(12), "Table 7");
    const uniforms = seeded.json().live.needs[1].id as string;
    await pledge(guest.token, uniforms, { units: 2 });
    const csv = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.csv`, headers: { cookie } });
    expect(csv.body).toContain("Pledges");
    expect(csv.body).toContain("School uniforms for 30 children");
    expect(csv.body).toContain("Table 7");
    const xlsx = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.xlsx`, headers: { cookie } });
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Pledges")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Need");
    expect(sheet.getRow(2).getCell(1).value).toBe("School uniforms for 30 children");
    expect(sheet.getRow(2).getCell(7).value).toBe(1600);
  });
});
