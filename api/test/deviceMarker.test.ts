import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createOpenEvent, freshApp, hostCookie, pool } from "./helpers.js";

let app: FastifyInstance;
let code: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  const cookie = await hostCookie(app);
  code = (await createOpenEvent(app, cookie, [{ title: "Watch", startingBid: 1000, minIncrement: 100 }])).code;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

/** Extracts `name=value` for one cookie from a response's set-cookie headers. */
function cookieFrom(res: { headers: Record<string, unknown> }, name: string): string | null {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const c of list) {
    const m = String(c).match(new RegExp(`^${name}=([^;]*)`));
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

function join(phone: string, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/join`,
    headers: cookie ? { cookie } : {},
    payload: { phone, name: "Anna" },
  });
}

describe("device marker: re-login on the same device", () => {
  it("issues a long-lived httpOnly device cookie on join", async () => {
    const res = await join("081-000-0001");
    expect(res.statusCode).toBe(200);
    const raw = String(res.headers["set-cookie"]);
    expect(raw).toMatch(/fl_device=[A-Za-z0-9_-]{32}/);
    expect(raw).toMatch(/fl_device=[^,]*HttpOnly/i);
    expect(raw).toMatch(/fl_device=[^,]*Max-Age=\d{7,}/i);
  });

  it("after 'Not you? Log out', the same device re-joins with the same phone without a code", async () => {
    const first = await join("081-000-0001");
    const device = cookieFrom(first, "fl_device")!;
    expect(device).toBeTruthy();
    const out = await app.inject({ method: "POST", url: `/api/events/${code}/logout`, headers: { cookie: device } });
    expect(out.statusCode).toBe(200);
    // Logout clears the guest session but keeps the device marker.
    expect(cookieFrom(out, "fl_device")).toBeNull();
    const again = await join("081-000-0001", device);
    expect(again.statusCode).toBe(200);
    expect(again.json().guest.id).toBe(first.json().guest.id);
    expect(cookieFrom(again, "fl_guest")).toBeTruthy();
  });

  it("a different device (no / unknown marker) still needs a code", async () => {
    await join("081-000-0001");
    expect((await join("081-000-0001")).statusCode).toBe(202);
    expect((await join("081-000-0001", "fl_device=" + "x".repeat(32))).statusCode).toBe(202);
  });

  it("a device only becomes trusted after successful auth — a code request does not trust it", async () => {
    await join("081-000-0001");
    const other = await join("081-000-0001");
    expect(other.statusCode).toBe(202);
    const otherDevice = cookieFrom(other, "fl_device")!;
    expect(otherDevice).toBeTruthy();
    // Asking again from that device still needs the code (no impersonation by retrying).
    expect((await join("081-000-0001", otherDevice)).statusCode).toBe(202);
  });

  it("a trusted device is per guest: it does not unlock someone else's phone", async () => {
    const anna = await join("081-000-0001");
    const device = cookieFrom(anna, "fl_device")!;
    await join("081-000-0002"); // Ben, on his own device
    expect((await join("081-000-0002", device)).statusCode).toBe(202);
  });

  it("an already signed-in session gets its device remembered via /me", async () => {
    const first = await join("081-000-0001");
    const token = first.json().guest.token as string;
    await pool.query("DELETE FROM guest_devices");
    const me = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": token } });
    expect(me.json().guest).toBeTruthy();
    const device = cookieFrom(me, "fl_device")!;
    expect(device).toBeTruthy();
    expect((await join("081-000-0001", device)).statusCode).toBe(200);
  });
});

describe("name later (inline on the bid page)", () => {
  it("guest joins with phone only, board shows a neutral Guest <n> until they add a name", async () => {
    const res = await join("081-000-1234");
    const guest = res.json().guest;
    // join() sends name "Anna" — use a fresh phone without a name instead:
    const anon = await app.inject({ method: "POST", url: `/api/events/${code}/join`, payload: { phone: "081-000-4321" } });
    expect(anon.statusCode).toBe(200);
    const g = anon.json().guest;
    expect(g.name).toBe("Guest 2"); // second guest of this event; no phone digits
    expect(g.nameSet).toBe(false);
    expect(guest.nameSet).toBe(true);

    const put = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/name`,
      headers: { "x-guest-token": g.token },
      payload: { name: "  Ben   K. " },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().guest).toMatchObject({ name: "Ben K.", nameSet: true });
    const me = await app.inject({ method: "GET", url: `/api/events/${code}/me`, headers: { "x-guest-token": g.token } });
    expect(me.json().guest).toMatchObject({ name: "Ben K.", nameSet: true });

    const reset = await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/name`,
      headers: { "x-guest-token": g.token },
      payload: { name: "" },
    });
    expect(reset.json().guest).toMatchObject({ name: "Guest 2", nameSet: false });
  });

  it("needs a guest session", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/events/${code}/me/name`, payload: { name: "X" } });
    expect(res.statusCode).toBe(401);
  });
});
