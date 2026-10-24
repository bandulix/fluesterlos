// Host browser / server in a non-Bangkok zone: nothing below may depend on the process zone.
process.env.TZ = "America/New_York";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, multipart, ph, pool } from "./helpers.js";

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

const host = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function live(code: string) {
  return (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
}

async function hostEvent(code: string) {
  const list = (await host("GET", "/api/host/events")).json().events as Array<Record<string, unknown>>;
  return list.find((e) => e.code === code)!;
}

async function closeAndPay(code: string, itemId: string) {
  const g = await joinGuest(app, code, ph(1), "Anna");
  expect((await bid(app, code, g.token, itemId, 1000)).statusCode).toBe(200);
  expect((await host("POST", `/api/host/events/${code}/close`, {})).statusCode).toBe(200);
  const inv = (await host("GET", `/api/host/events/${code}/invoices`)).json().invoices[0];
  const paid = await host("POST", `/api/host/invoices/${inv.id}/confirm-payment`, { method: "cash" });
  expect(paid.statusCode).toBe(200);
  return g;
}

describe("event time zone", () => {
  it("stores absolute instants from ISO-with-offset, independent of the server zone", async () => {
    expect(new Date("2027-01-17T19:00:00").getTimezoneOffset()).toBe(300); // really running in New York
    const res = await host("POST", "/api/host/events", {
      title: "Gala",
      startsAt: "2027-01-17T19:00:00+07:00",
      endsAt: "2027-01-17T22:00:00+07:00",
    });
    expect(res.statusCode).toBe(200);
    const ev = res.json().event;
    expect(ev.startsAt).toBe("2027-01-17T12:00:00.000Z");
    expect(ev.endsAt).toBe("2027-01-17T15:00:00.000Z");
    expect(ev.timezone).toBe("Asia/Bangkok");
    expect(ev.status).toBe("scheduled");
    const db = await pool.query("SELECT starts_at FROM events WHERE code = $1", [ev.code]);
    expect(new Date(db.rows[0].starts_at).toISOString()).toBe("2027-01-17T12:00:00.000Z");
  });

  it("rejects times without an offset (they would be read in some server zone)", async () => {
    const res = await host("POST", "/api/host/events", {
      title: "Gala",
      startsAt: "2027-01-17T19:00",
      endsAt: "2027-01-17T22:00",
    });
    expect(res.statusCode).toBe(400);
  });

  it("keeps the chosen event time zone and validates it", async () => {
    const ok = await host("POST", "/api/host/events", {
      title: "Berlin",
      startsAt: "2027-01-17T19:00:00+01:00",
      endsAt: "2027-01-17T22:00:00+01:00",
      timezone: "Europe/Berlin",
    });
    expect(ok.json().event.timezone).toBe("Europe/Berlin");
    expect((await hostEvent(ok.json().event.code)).timezone).toBe("Europe/Berlin");
    const bad = await host("POST", "/api/host/events", {
      title: "Bad",
      startsAt: "2027-01-17T19:00:00Z",
      endsAt: "2027-01-17T22:00:00Z",
      timezone: "Mars/Olympus",
    });
    expect(bad.statusCode).toBe(400);
    const patch = await host("PATCH", `/api/host/events/${ok.json().event.code}`, { timezone: "Asia/Bangkok" });
    expect(patch.json().event.timezone).toBe("Asia/Bangkok");
  });

  it("host settings expose the default event time zone", async () => {
    expect((await host("GET", "/api/host/settings")).json().defaultTimezone).toBe("Asia/Bangkok");
  });
});

describe("host event controls", () => {
  it("close now: stops bidding immediately and records who closed it", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    const g = await joinGuest(app, code, ph(1), "Anna");
    const closed = await host("POST", `/api/host/events/${code}/close`, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json().event).toMatchObject({ status: "closed", closedEarly: true });
    expect((await bid(app, code, g.token, items[0].id, 1000)).statusCode).toBe(400);
    expect(await hostEvent(code)).toMatchObject({ closedBy: "host@example.org", status: "closed" });
    expect((await host("POST", `/api/host/events/${code}/close`, {})).statusCode).toBe(409);
  });

  it("extend adds minutes to an open auction", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    const before = Date.parse((await live(code)).event.endsAt);
    const res = await host("POST", `/api/host/events/${code}/extend`, { minutes: 15 });
    expect(res.statusCode).toBe(200);
    expect(Date.parse(res.json().event.endsAt) - before).toBe(15 * 60_000);
    expect((await host("POST", `/api/host/events/${code}/extend`, { minutes: 0 })).statusCode).toBe(400);
  });

  it("reopens a closed auction while nothing is paid; bidding works again and the close reason clears", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    const g = await joinGuest(app, code, ph(1), "Anna");
    await bid(app, code, g.token, items[0].id, 1000);
    await host("POST", `/api/host/events/${code}/close`, {});
    // An (unpaid) invoice exists now.
    expect((await host("GET", `/api/host/events/${code}/invoices`)).json().invoices).toHaveLength(1);
    const res = await host("POST", `/api/host/events/${code}/extend`, { minutes: 10 });
    expect(res.statusCode).toBe(200);
    expect(res.json().event).toMatchObject({ status: "open", closedEarly: false });
    const end = Date.parse(res.json().event.endsAt);
    expect(end).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect((await bid(app, code, g.token, items[0].id, 1100)).statusCode).toBe(200);
    // While open again, no invoices are shown.
    expect((await host("GET", `/api/host/events/${code}/invoices`)).json().invoices).toHaveLength(0);
  });

  it("refuses to reopen once an invoice is paid (extend or new end time)", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    await closeAndPay(code, items[0].id);
    expect((await hostEvent(code)).paidInvoiceCount).toBe(1);
    const ext = await host("POST", `/api/host/events/${code}/extend`, { minutes: 10 });
    expect(ext.statusCode).toBe(409);
    expect(ext.json().error).toMatch(/already paid/);
    const sched = await host("PUT", `/api/host/events/${code}/schedule`, {
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(sched.statusCode).toBe(409);
    const patch = await host("PATCH", `/api/host/events/${code}`, {
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(patch.statusCode).toBe(409);
    expect((await live(code)).event.status).toBe("closed");
  });

  it("edits start/end; end must be after start; start can't move into the future once there are bids", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    const newEnd = "2030-01-01T21:00:00+07:00";
    const ok = await host("PUT", `/api/host/events/${code}/schedule`, { endsAt: newEnd });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().event.endsAt).toBe("2030-01-01T14:00:00.000Z");
    const bad = await host("PUT", `/api/host/events/${code}/schedule`, {
      startsAt: "2030-01-02T00:00:00Z",
      endsAt: "2030-01-01T00:00:00Z",
    });
    expect(bad.statusCode).toBe(400);
    expect((await host("PUT", `/api/host/events/${code}/schedule`, { endsAt: "2030-01-01 21:00" })).statusCode).toBe(400);
    const g = await joinGuest(app, code, ph(1), "Anna");
    await bid(app, code, g.token, items[0].id, 1000);
    const later = await host("PUT", `/api/host/events/${code}/schedule`, { startsAt: "2029-12-31T00:00:00Z" });
    expect(later.statusCode).toBe(409);
  });

  it("controls require a host", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    expect((await app.inject({ method: "POST", url: `/api/host/events/${code}/close`, payload: {} })).statusCode).toBe(401);
  });
});

describe("item edit / delete", () => {
  function patchItem(code: string, itemId: string, fields: Record<string, string>, files: Parameters<typeof multipart>[1] = []) {
    const mp = multipart(fields, files);
    return app.inject({
      method: "PATCH",
      url: `/api/host/events/${code}/items/${itemId}`,
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.payload,
    });
  }

  it("edits everything before bids; after a bid prices/type lock but title and sponsor still change", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    const id = items[0].id;
    const r1 = await patchItem(code, id, { title: "Spa day", startingBid: "1500", minIncrement: "250", buyNow: "5000", kind: "physical", sponsorName: "Grand Hotel" });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().items[0]).toMatchObject({ title: "Spa day", startingBid: 1500, minIncrement: 250, buyNow: 5000, kind: "physical", sponsor: { name: "Grand Hotel" } });
    expect((await patchItem(code, id, { buyNow: "1000" })).statusCode).toBe(400); // buy-now must exceed start

    const g = await joinGuest(app, code, ph(1), "Anna");
    expect((await bid(app, code, g.token, id, 1500)).statusCode).toBe(200);
    expect((await patchItem(code, id, { startingBid: "2000" })).statusCode).toBe(409);
    expect((await patchItem(code, id, { kind: "voucher" })).statusCode).toBe(409);
    // Unchanged values sent along with an edit are fine (the form sends all fields).
    const r2 = await patchItem(code, id, { title: "Spa day for two", startingBid: "1500", sponsorName: "" });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().items[0]).toMatchObject({ title: "Spa day for two", sponsor: null });
  });

  it("switching a voucher item to physical drops its PDF", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    const mp = multipart({ title: "Hotel", startingBid: "1000", minIncrement: "100" }, [
      { field: "voucherPdf", filename: "v.pdf", type: "application/pdf", content: "%PDF-1.4 t" },
    ]);
    const add = await app.inject({ method: "POST", url: `/api/host/events/${code}/items`, headers: { cookie, "content-type": mp.contentType }, payload: mp.payload });
    const id = add.json().items[0].id;
    const pdf = await host("GET", `/api/host/events/${code}/items/${id}/voucher`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const r = await patchItem(code, id, { kind: "physical" });
    expect(r.json().items[0]).toMatchObject({ kind: "physical", hasVoucher: false });
    expect((await host("GET", `/api/host/events/${code}/items/${id}/voucher`)).statusCode).toBe(404);
  });

  it("after close only title/description/sponsor/photo can change", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    await host("POST", `/api/host/events/${code}/close`, {});
    expect((await patchItem(code, items[0].id, { startingBid: "500" })).statusCode).toBe(409);
    expect((await patchItem(code, items[0].id, { title: "Spa (renamed)" })).statusCode).toBe(200);
  });

  it("deletes items without bids only", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [
      { title: "A", startingBid: 1000, minIncrement: 100 },
      { title: "B", startingBid: 1000, minIncrement: 100 },
    ]);
    const g = await joinGuest(app, code, ph(1), "Anna");
    await bid(app, code, g.token, items[1].id, 1000);
    expect((await host("DELETE", `/api/host/events/${code}/items/${items[1].id}`)).statusCode).toBe(409);
    const del = await host("DELETE", `/api/host/events/${code}/items/${items[0].id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().items.map((i: { title: string }) => i.title)).toEqual(["B"]);
    expect((await host("DELETE", `/api/host/events/${code}/items/${items[0].id}`)).statusCode).toBe(404);
  });
});

describe("guest status on the bid page", () => {
  it("me tells the guest which items they lead and which they were outbid on", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Spa", startingBid: 1000, minIncrement: 100 }]);
    const anna = await joinGuest(app, code, ph(1), "Anna");
    const ben = await joinGuest(app, code, ph(2), "Ben");
    await bid(app, code, anna.token, items[0].id, 1000);
    const meAnna = (await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": anna.token } })).json();
    expect(meAnna.bidItemIds).toEqual([items[0].id]);
    expect((await live(code)).items[0].leaderKey).toBe(meAnna.leaderKey);

    await bid(app, code, ben.token, items[0].id, 1100);
    const meBen = (await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": ben.token } })).json();
    const now = await live(code);
    expect(now.items[0].leaderKey).toBe(meBen.leaderKey);
    expect(now.items[0].leaderKey).not.toBe(meAnna.leaderKey); // Anna: outbid
    expect(JSON.stringify(now)).not.toContain(anna.id); // no guest ids leak into the public payload
  });

  it("stores the big-screen language and rejects an unknown one", async () => {
    const { code } = await createOpenEvent(app, cookie, [{ title: "Vase", startingBid: 1000, minIncrement: 100 }]);
    expect((await live(code)).event.screenLanguage).toBe("en");
    const bad = await host("PATCH", `/api/host/events/${code}`, { screenLanguage: "fr" });
    expect(bad.statusCode).toBe(400);
    const ok = await host("PATCH", `/api/host/events/${code}`, { screenLanguage: "both" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().event.screenLanguage).toBe("both");
    expect((await live(code)).event.screenLanguage).toBe("both");
  });

  it("logout clears the guest cookie", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    const res = await app.inject({ method: "POST", url: `/api/events/${code}/logout`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toMatch(/fl_guest=;/);
  });
});
