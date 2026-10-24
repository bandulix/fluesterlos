import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";
import { anonymousGiftLabel, rankDonors, recognitionPatch, supportersForNeed, type DonorProfile, type Gift } from "../src/recognition.js";
import { pledgeWho } from "../src/pledges.js";

let app: FastifyInstance;
let cookie: string;
let code: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 1000, minIncrement: 100 }]);
  code = ev.code;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

function profile(partial: Partial<DonorProfile> & Pick<DonorProfile, "guestId">): DonorProfile {
  return {
    guestName: partial.guestId,
    namedPublicly: false,
    publicName: "",
    moderatedName: "",
    showAmount: false,
    hiddenByHost: false,
    ...partial,
  };
}

describe("donor recognition math", () => {
  it("defaults to unnamed, aggregates anonymous gifts, and hides amounts", () => {
    const current = { namedPublicly: false, publicName: "", moderatedName: "", showAmount: false, hiddenByHost: false };
    const untouched = recognitionPatch(current, { guestName: "Ada" });
    expect(untouched.ok && untouched.touched).toBe(false);
    expect(recognitionPatch(current, { guestName: "Ada", namedPublicly: false })).toMatchObject({ namedPublicly: false });
    expect(recognitionPatch(current, { guestName: "Ada", anonymous: false })).toMatchObject({ namedPublicly: true, publicName: "Ada", showAmount: false });
    expect(recognitionPatch(current, { guestName: "Ada", namedPublicly: true, publicName: "The Müller Family", showAmount: false })).toMatchObject({
      publicName: "The Müller Family",
      showAmount: false,
    });
    expect(pledgeWho({ namedPublicly: false, guestName: "Ada" })).toBe("A guest");
    expect(pledgeWho({ namedPublicly: true, publicName: "The Müller Family", guestName: "Ada" })).toBe("The Müller Family");
    expect(pledgeWho({ anonymous: false, guestName: "Table 7" })).toBe("Table 7");

    const gifts: Gift[] = [
      { guestId: "a", needId: "n1", amount: 3000, active: true },
      { guestId: "a", needId: "n2", amount: 2000, active: true },
      { guestId: "b", needId: "n1", amount: 4000, active: true },
      { guestId: "c", needId: "n1", amount: 500, active: true },
      { guestId: "a", needId: "n2", amount: 9000, active: false },
    ];
    const profiles = [
      profile({ guestId: "a", namedPublicly: true, publicName: "The Müller Family", showAmount: false }),
      profile({ guestId: "b", namedPublicly: true, publicName: "Siam Hotels Co.", showAmount: true }),
      profile({ guestId: "c", namedPublicly: false, publicName: "Hidden Guest" }),
    ];
    const need = supportersForNeed("n1", gifts, profiles);
    expect(need.anonymousGifts).toBe(1);
    expect(anonymousGiftLabel(need.anonymousGifts)).toBe("+ 1 anonymous gift");
    expect(need.donors.map((d) => ({ name: d.name, amount: d.amount }))).toEqual([
      { name: "Siam Hotels Co.", amount: 4000 },
      { name: "The Müller Family", amount: null },
    ]);
    const ranked = rankDonors(gifts, profiles, 10);
    expect(ranked.map((d) => ({ name: d.name, rank: d.rank, tier: d.tier, amount: d.amount, total: d.total }))).toEqual([
      { name: "The Müller Family", rank: 1, tier: "gold", amount: null, total: 5000 },
      { name: "Siam Hotels Co.", rank: 2, tier: "silver", amount: 4000, total: 4000 },
    ]);
    const voided = gifts.map((g) => (g.guestId === "a" ? { ...g, active: false } : g));
    expect(rankDonors(voided, profiles).map((d) => d.name)).toEqual(["Siam Hotels Co."]);
    const hidden = profiles.map((p) => (p.guestId === "b" ? { ...p, hiddenByHost: true } : p));
    expect(rankDonors(gifts, hidden).map((d) => d.name)).toEqual(["The Müller Family"]);
    expect(supportersForNeed("n1", gifts, hidden).anonymousGifts).toBe(2);
    const renamed = profiles.map((p) => (p.guestId === "b" ? { ...p, moderatedName: "Table 4" } : p));
    expect(rankDonors(gifts, renamed)[1].name).toBe("Table 4");
    expect(rankDonors(gifts, profiles, 10, false)).toEqual([]);
  });
});

describe("donor recognition api", () => {
  async function addNeed(title: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/needs`,
      headers: { cookie },
      payload: { title, beneficiary: "Thai.GER charity", targetAmount: 100000, minPledge: 500, suggestedAmounts: [1000, 5000], ...extra },
    });
    expect(res.statusCode).toBe(200);
    return res.json().id as string;
  }

  function pledge(token: string, needId: string, body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/api/events/${code}/pledges`,
      headers: { "x-guest-token": token },
      payload: { needId, ...body },
    });
  }

  it("keeps the default private, ranks across needs, and drops voided or hidden gifts", async () => {
    const playground = await addNeed("Playground");
    const lunches = await addNeed("Lunches");
    const ada = await joinGuest(app, code, ph(1), "Ada");
    const sam = await joinGuest(app, code, ph(2), "Sam");
    const quiet = await joinGuest(app, code, ph(3), "Quiet");

    const plain = await pledge(quiet.token, playground, { amount: 1000 });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().text).toBe("A guest pledged ฿1,000");
    expect(plain.json().live.needs.find((n: { id: string }) => n.id === playground)).toMatchObject({ supporters: [], anonymousGifts: 1 });
    expect(plain.json().live.topDonors).toEqual([]);
    expect(JSON.stringify(plain.json().live.recentPledges)).not.toContain("Quiet");

    await pledge(ada.token, playground, { amount: 3000, namedPublicly: true, publicName: "The Müller Family" });
    await pledge(ada.token, lunches, { amount: 2000, namedPublicly: true, publicName: "The Müller Family" });
    const shown = await pledge(sam.token, playground, { amount: 4000, namedPublicly: true, publicName: "Siam Hotels Co.", showAmount: true });
    expect(shown.statusCode).toBe(200);
    const live = shown.json().live;
    const play = live.needs.find((n: { id: string }) => n.id === playground);
    expect(play.supporters).toEqual([
      { name: "Siam Hotels Co.", amount: 4000 },
      { name: "The Müller Family", amount: null },
    ]);
    expect(play.anonymousGifts).toBe(1);
    expect(play.raised).toBe(8000);
    expect(live.topDonors.map((d: { name: string; amount: number | null; tier: string }) => ({ name: d.name, amount: d.amount, tier: d.tier }))).toEqual([
      { name: "The Müller Family", amount: null, tier: "gold" },
      { name: "Siam Hotels Co.", amount: 4000, tier: "silver" },
    ]);
    expect(JSON.stringify(live.topDonors)).not.toContain("5000");
    expect(JSON.stringify(live.topDonors)).not.toContain("3000");

    await bid(app, code, ada.token, (await app.inject({ method: "GET", url: `/api/events/${code}` })).json().items[0].id, 50000);
    const afterBid = await app.inject({ method: "GET", url: `/api/events/${code}` });
    expect(afterBid.json().topDonors[0].name).toBe("The Müller Family");
    expect(afterBid.json().stats.totalHighBids).toBe(50000);

    const hostNeeds = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
    const adaPledge = hostNeeds.json().needs.flatMap((n: { pledges: Array<{ guestName: string; id: string; status: string }> }) => n.pledges).filter((p: { guestName: string; status: string }) => p.guestName === "Ada" && p.status === "active");
    for (const p of adaPledge) {
      const voided = await app.inject({
        method: "POST",
        url: `/api/host/events/${code}/pledges/${p.id}/void`,
        headers: { cookie },
        payload: { reason: "Duplicate slip" },
      });
      expect(voided.statusCode).toBe(200);
    }
    const dropped = await app.inject({ method: "GET", url: `/api/events/${code}` });
    expect(dropped.json().topDonors.map((d: { name: string }) => d.name)).toEqual(["Siam Hotels Co."]);

    const edited = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/recognition`,
      headers: { cookie },
      payload: { guestId: sam.id, name: "Table 4", reason: "Company name was wrong" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().live.topDonors[0].name).toBe("Table 4");
    expect(JSON.stringify(edited.json().live.topDonors)).not.toContain("Siam Hotels");
    const hidden = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/recognition`,
      headers: { cookie },
      payload: { guestId: sam.id, hidden: true, reason: "Inappropriate" },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().live.topDonors).toEqual([]);
    const playAfter = hidden.json().live.needs.find((n: { id: string }) => n.id === playground);
    expect(playAfter.anonymousGifts).toBe(2);
    expect(JSON.stringify(playAfter.supporters)).not.toContain("Table 4");
    const board = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
    const samRow = board.json().recognition.donors.find((d: { guestId: string }) => d.guestId === sam.id);
    expect(samRow.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(["host_edit", "host_hide"]));

    const csv = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.csv`, headers: { cookie } });
    expect(csv.body).toContain("Named publicly");
    expect(csv.body).toContain("Public name");
    expect(csv.body).toContain("The Müller Family");

    const off = await app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/fund`,
      headers: { cookie },
      payload: { donorRecognition: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().live.topDonors).toEqual([]);
    expect(JSON.stringify(off.json().live.recentPledges)).not.toContain("Table 4");
    expect(JSON.stringify(off.json().live.recentPledges)).not.toContain("The Müller Family");
  });

  it("lets a guest change visibility from their own record", async () => {
    const needId = await addNeed("Uniforms");
    const ada = await joinGuest(app, code, ph(4), "Ada");
    await pledge(ada.token, needId, { amount: 2500, namedPublicly: true, publicName: "The Müller Family", showAmount: true });
    const mine = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/recognition`,
      headers: { "x-guest-token": ada.token },
      payload: { namedPublicly: false, showAmount: false },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().live.topDonors).toEqual([]);
    expect(mine.json().live.needs[0].anonymousGifts).toBe(1);
    expect(mine.json().recognition).toMatchObject({ namedPublicly: false, hiddenByHost: false });
  });
});
