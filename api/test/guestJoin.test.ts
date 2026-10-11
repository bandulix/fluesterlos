import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, e164, freshApp, hostCookie, joinGuest, mailbox, ph, pool } from "./helpers.js";

let app: FastifyInstance;
let cookie: string;
let code: string;
let itemId: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Watch", startingBid: 1000, minIncrement: 100 }]);
  code = ev.code;
  itemId = ev.items[0].id;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

function join(phone: string, opts: { name?: string; token?: string; email?: string } = {}) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/join`,
    headers: opts.token ? { "x-guest-token": opts.token } : {},
    payload: { phone, name: opts.name ?? "", ...(opts.email ? { email: opts.email } : {}) },
  });
}

function verify(phone: string, c: string) {
  return app.inject({ method: "POST", url: `/api/events/${code}/join/verify`, payload: { phone, code: c } });
}

function lastMailedCode(): string {
  const m = mailbox.sent.at(-1)?.text.match(/Your code: (\d{6})/);
  if (!m) throw new Error("no code mailed");
  return m[1];
}

async function deskRequests() {
  const res = await app.inject({ method: "GET", url: `/api/host/events/${code}/login-requests`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json().requests as Array<{ code: string; phone: string; delivery: string; guestName: string }>;
}

describe("guest join by phone", () => {
  it("normalizes Thai local numbers to E.164 and joins new phones directly", async () => {
    const res = await join("081-000-0001", { name: "Anna" });
    expect(res.statusCode).toBe(200);
    expect(res.json().guest).toMatchObject({ phone: "+66810000001", name: "Anna", email: null });
    expect(res.json().guest.token).toHaveLength(24);
    expect(String(res.headers["set-cookie"])).toMatch(/fl_guest=/);
    // Same number in another format is the same guest (and needs a code on a new device).
    expect((await join("+66 81 000 0001")).statusCode).toBe(202);
  });

  it("rejects invalid phone numbers", async () => {
    const res = await join("12345");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/phone/i);
  });

  it("board name defaults to a neutral per-event number, never phone digits", async () => {
    const g = await joinGuest(app, code, ph(1234));
    expect((await bid(app, code, g.token, itemId, 1000)).statusCode).toBe(200);
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    expect(live.items[0].highBidder).toBe("Guest 1");
    expect(JSON.stringify(live)).not.toContain(e164(1234));
    expect(JSON.stringify(live)).not.toContain("…");
    // Numbers count up per event; re-joining does not use up a number.
    const g2 = await joinGuest(app, code, ph(5678));
    await joinGuest(app, code, ph(1234)).catch(() => undefined);
    const g3 = await joinGuest(app, code, ph(9012));
    expect([g.name, g2.name, g3.name]).toEqual(["Guest 1", "Guest 2", "Guest 3"]);
  });

  it("existing phone on a new device with an email on file: code is emailed, token not leaked", async () => {
    const original = await joinGuest(app, code, ph(1), "Anna", "anna@example.org");
    const res = await join(ph(1), { name: "Mallory", email: "mallory@evil.example" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      verificationRequired: true,
      phone: e164(1),
      delivery: "email",
      maskedEmail: "an***@example.org",
      resendInSeconds: 60,
    });
    expect(res.body).not.toContain(original.token);
    // No guest session for the new device (only an untrusted device marker).
    expect(String(res.headers["set-cookie"] ?? "")).not.toMatch(/fl_guest=/);
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0].to).toBe("anna@example.org");
    const { rows } = await pool.query("SELECT name, email FROM guests WHERE id = $1", [original.id]);
    expect(rows[0]).toEqual({ name: "Anna", email: "anna@example.org" });
    // Also visible on the help desk.
    const desk = await deskRequests();
    expect(desk).toHaveLength(1);
    expect(desk[0]).toMatchObject({ phone: e164(1), delivery: "email", code: lastMailedCode() });
  });

  it("existing phone without email: code goes to the host help desk only", async () => {
    const original = await joinGuest(app, code, ph(2), "Ben");
    const res = await join(ph(2));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ delivery: "desk", maskedEmail: null });
    expect(mailbox.sent).toHaveLength(0);
    const desk = await deskRequests();
    expect(desk).toHaveLength(1);
    expect(desk[0]).toMatchObject({ guestName: "Ben", phone: e164(2), delivery: "desk" });
    const ok = await verify(ph(2), desk[0].code);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().guest).toMatchObject({ id: original.id, token: original.token });
    // Used codes disappear from the desk.
    expect(await deskRequests()).toHaveLength(0);
  });

  it("help desk requires a host session", async () => {
    const res = await app.inject({ method: "GET", url: `/api/host/events/${code}/login-requests` });
    expect(res.statusCode).toBe(401);
  });

  it("wrong code fails, code is single-use, locks after 5 wrong attempts", async () => {
    await joinGuest(app, code, ph(1), "", "anna@example.org");
    await join(ph(1));
    const c = lastMailedCode();
    const wrong = c === "000000" ? "111111" : "000000";
    expect((await verify(ph(1), wrong)).statusCode).toBe(400);
    expect((await verify(ph(1), c)).statusCode).toBe(200);
    expect((await verify(ph(1), c)).statusCode).toBe(400);

    await pool.query("UPDATE guest_login_codes SET created_at = now() - interval '2 minutes'");
    await join(ph(1));
    const c2 = lastMailedCode();
    const wrong2 = c2 === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify(ph(1), wrong2)).statusCode).toBe(400);
    expect((await verify(ph(1), c2)).statusCode).toBe(400);
    expect(await deskRequests()).toHaveLength(0);
  });

  it("does not resend a code within 60 seconds", async () => {
    await joinGuest(app, code, ph(1), "", "anna@example.org");
    await join(ph(1));
    const again = await join(ph(1));
    expect(again.statusCode).toBe(202);
    expect(again.json().resendInSeconds).toBeGreaterThan(0);
    expect(mailbox.sent).toHaveLength(1);
  });

  it("same device (presenting its token) re-joins without a code and can add an email", async () => {
    const original = await joinGuest(app, code, ph(1));
    const res = await join(ph(1), { name: "Anna B.", token: original.token, email: "anna@example.org" });
    expect(res.statusCode).toBe(200);
    expect(res.json().guest).toMatchObject({ token: original.token, name: "Anna B.", email: "anna@example.org" });
    expect(mailbox.sent).toHaveLength(0);
  });

  it("another guest's token does not unlock a different phone", async () => {
    await joinGuest(app, code, ph(1));
    const ben = await joinGuest(app, code, ph(2));
    expect((await join(ph(1), { token: ben.token })).statusCode).toBe(202);
  });

  it("host adds guests by phone; they join once without a code, a second device needs one", async () => {
    const add = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/guests`,
      headers: { cookie },
      payload: { phone: "089 000 0009", name: "VIP" },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().guest).toMatchObject({ phone: "+66890000009", name: "VIP" });
    expect(add.body).not.toMatch(/"token"/);
    const list = (await app.inject({ method: "GET", url: `/api/host/events/${code}/guests`, headers: { cookie } })).json();
    expect(list.guests[0]).toMatchObject({ phone: "+66890000009", joined: false });
    expect((await join("0890000009")).statusCode).toBe(200);
    expect((await join("0890000009")).statusCode).toBe(202);
  });

  it("without SMTP an emailed code falls back to desk + log", async () => {
    await joinGuest(app, code, ph(1), "", "anna@example.org");
    mailbox.smtp = false;
    const res = await join(ph(1));
    expect(res.statusCode).toBe(202);
    expect(res.json().delivery).toBe("desk");
    expect(mailbox.sent).toHaveLength(0);
    expect(await deskRequests()).toHaveLength(1);
  });

  it("guest can add their email later (for voucher PDFs)", async () => {
    const g = await joinGuest(app, code, ph(1));
    const res = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/email`,
      headers: { "x-guest-token": g.token },
      payload: { email: "Late@Example.org" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().guest.email).toBe("late@example.org");
    const anon = await app.inject({ method: "PUT", url: `/api/events/${code}/me/email`, payload: { email: "x@example.org" } });
    expect(anon.statusCode).toBe(401);
  });
});

describe("rate limits and CORS", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("limits join attempts per IP + phone", async () => {
    process.env.RATE_LIMIT_JOIN_PER_MIN = "3";
    await app.close();
    app = await freshApp();
    cookie = await hostCookie(app);
    code = (await createOpenEvent(app, cookie, [{ title: "W", startingBid: 1, minIncrement: 1 }])).code;
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await join(ph(1))).statusCode);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    // A different phone from the same IP (venue Wi-Fi) is unaffected.
    expect((await join(ph(2))).statusCode).toBe(200);
  });

  it("limits bids per guest", async () => {
    process.env.RATE_LIMIT_BID_PER_10S = "2";
    await app.close();
    app = await freshApp();
    cookie = await hostCookie(app);
    const ev = await createOpenEvent(app, cookie, [{ title: "W", startingBid: 1, minIncrement: 1 }]);
    const g = await joinGuest(app, ev.code, ph(1));
    const other = await joinGuest(app, ev.code, ph(2));
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await bid(app, ev.code, g.token, ev.items[0].id, 1 + i)).statusCode);
    expect(s).toEqual([200, 200, 429]);
    expect((await bid(app, ev.code, other.token, ev.items[0].id, 10)).statusCode).toBe(200);
  });

  it("CORS allows only PUBLIC_URL / CORS_ORIGINS", async () => {
    const good = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:8080" } });
    expect(good.headers["access-control-allow-origin"]).toBe("http://localhost:8080");
    const evil = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();

    process.env.CORS_ORIGINS = "https://auction.example.org, http://localhost:5173";
    await app.close();
    app = await freshApp();
    const dev = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://localhost:5173" } });
    expect(dev.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
