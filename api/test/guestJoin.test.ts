import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, mailbox, pool } from "./helpers.js";

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

function join(email: string, opts: { name?: string; token?: string } = {}) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/join`,
    headers: opts.token ? { "x-guest-token": opts.token } : {},
    payload: { email, name: opts.name ?? "" },
  });
}

function verify(email: string, c: string) {
  return app.inject({ method: "POST", url: `/api/events/${code}/join/verify`, payload: { email, code: c } });
}

function lastCode(): string {
  const m = mailbox.sent.at(-1)?.text.match(/Your code: (\d{6})/);
  if (!m) throw new Error("no code mailed");
  return m[1];
}

describe("guest join", () => {
  it("new email joins directly and gets a token", async () => {
    const res = await join("anna@example.org", { name: "Anna" });
    expect(res.statusCode).toBe(200);
    expect(res.json().guest.token).toHaveLength(24);
    expect(String(res.headers["set-cookie"])).toMatch(/fl_guest=/);
  });

  it("existing email from a new device does NOT get the token; a code is emailed instead", async () => {
    const original = await joinGuest(app, code, "anna@example.org", "Anna");
    const res = await join("Anna@Example.org", { name: "Mallory" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ verificationRequired: true, email: "anna@example.org", resendInSeconds: 60 });
    expect(res.body).not.toContain(original.token);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0].to).toBe("anna@example.org");
    // Name was not hijacked.
    const { rows } = await pool.query("SELECT name FROM guests WHERE id = $1", [original.id]);
    expect(rows[0].name).toBe("Anna");
  });

  it("correct code returns the same guest; wrong code fails; code is single-use", async () => {
    const original = await joinGuest(app, code, "anna@example.org");
    await join("anna@example.org");
    const c = lastCode();
    const wrong = c === "000000" ? "111111" : "000000";
    expect((await verify("anna@example.org", wrong)).statusCode).toBe(400);
    const ok = await verify("anna@example.org", c);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().guest).toMatchObject({ id: original.id, token: original.token });
    expect((await verify("anna@example.org", c)).statusCode).toBe(400);
    // The verified device can bid.
    expect((await bid(app, code, ok.json().guest.token, itemId, 1000)).statusCode).toBe(200);
  });

  it("locks a code after 5 wrong attempts", async () => {
    await joinGuest(app, code, "anna@example.org");
    await join("anna@example.org");
    const c = lastCode();
    const wrong = c === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify("anna@example.org", wrong)).statusCode).toBe(400);
    expect((await verify("anna@example.org", c)).statusCode).toBe(400);
  });

  it("does not resend a code within 60 seconds", async () => {
    await joinGuest(app, code, "anna@example.org");
    await join("anna@example.org");
    const again = await join("anna@example.org");
    expect(again.statusCode).toBe(202);
    expect(again.json().resendInSeconds).toBeGreaterThan(0);
    expect(mailbox.sent).toHaveLength(1);
  });

  it("same device (presenting its token) re-joins without a code", async () => {
    const original = await joinGuest(app, code, "anna@example.org");
    const res = await join("anna@example.org", { name: "Anna B.", token: original.token });
    expect(res.statusCode).toBe(200);
    expect(res.json().guest).toMatchObject({ token: original.token, name: "Anna B." });
    expect(mailbox.sent).toHaveLength(0);
  });

  it("another guest's token does not unlock a different email", async () => {
    await joinGuest(app, code, "anna@example.org");
    const ben = await joinGuest(app, code, "ben@example.org");
    const res = await join("anna@example.org", { token: ben.token });
    expect(res.statusCode).toBe(202);
  });

  it("host-added guest joins once without a code; a second device then needs one", async () => {
    const add = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/guests`,
      headers: { cookie },
      payload: { email: "vip@example.org", name: "VIP" },
    });
    expect(add.statusCode).toBe(200);
    expect(add.body).not.toMatch(/"token"/);
    expect((await join("vip@example.org")).statusCode).toBe(200);
    expect((await join("vip@example.org")).statusCode).toBe(202);
  });

  it("without SMTP the join still requires a code (logged server-side) and sends no mail", async () => {
    await joinGuest(app, code, "anna@example.org");
    mailbox.smtp = false;
    const res = await join("anna@example.org");
    expect(res.statusCode).toBe(202);
    expect(mailbox.sent).toHaveLength(0);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM guest_login_codes");
    expect(rows[0].c).toBe(1);
  });
});

describe("rate limits and CORS", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("limits join attempts per IP + email", async () => {
    process.env.RATE_LIMIT_JOIN_PER_MIN = "3";
    await app.close();
    app = await freshApp();
    cookie = await hostCookie(app);
    code = (await createOpenEvent(app, cookie, [{ title: "W", startingBid: 1, minIncrement: 1 }])).code;
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await join("anna@example.org")).statusCode);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    // A different email from the same IP (venue Wi-Fi) is unaffected.
    expect((await join("ben@example.org")).statusCode).toBe(200);
  });

  it("limits bids per guest", async () => {
    process.env.RATE_LIMIT_BID_PER_10S = "2";
    await app.close();
    app = await freshApp();
    cookie = await hostCookie(app);
    const ev = await createOpenEvent(app, cookie, [{ title: "W", startingBid: 1, minIncrement: 1 }]);
    const g = await joinGuest(app, ev.code, "anna@example.org");
    const other = await joinGuest(app, ev.code, "ben@example.org");
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
