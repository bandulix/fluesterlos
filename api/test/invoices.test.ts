import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  bid,
  closeEvent,
  createOpenEvent,
  freshApp,
  hostCookie,
  joinGuest,
  mailbox,
  pool,
} from "./helpers.js";

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

function guestInvoice(code: string, token: string) {
  return app.inject({ method: "GET", url: `/api/events/${code}/invoice`, headers: { "x-guest-token": token } });
}

function uploadPayslip(code: string, token: string) {
  const boundary = "----fltest";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slip.png"\r\n` +
    `Content-Type: image/png\r\n\r\nPNGDATA\r\n--${boundary}--\r\n`;
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/invoice/payslip`,
    headers: { "x-guest-token": token, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

async function setup() {
  const ev = await createOpenEvent(app, cookie, [
    { title: "Watch", startingBid: 1000, minIncrement: 100 },
    { title: "Villa", startingBid: 2000, minIncrement: 200 },
  ]);
  const a = await joinGuest(app, ev.code, "a@example.org", "Anna");
  const b = await joinGuest(app, ev.code, "b@example.org", "Ben");
  return { ...ev, a, b };
}

describe("invoices while the auction is open", () => {
  it("guest sees no invoice, cannot upload a payslip, and nothing is created", async () => {
    const { code, items, a } = await setup();
    expect((await bid(app, code, a.token, items[0].id, 1000)).statusCode).toBe(200);

    const inv = await guestInvoice(code, a.token);
    expect(inv.statusCode).toBe(200);
    expect(inv.json()).toMatchObject({ invoice: null, message: expect.stringMatching(/after the auction closes/) });

    expect((await uploadPayslip(code, a.token)).statusCode).toBe(409);

    const host = await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } });
    expect(host.json().invoices).toEqual([]);

    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM invoices");
    expect(rows[0].c).toBe(0);
  });

  it("host cannot confirm payment of an (old-version) invoice before close", async () => {
    const { eventId, a } = await setup();
    const { rows } = await pool.query(
      "INSERT INTO invoices (event_id, guest_id, total) VALUES ($1, $2, 1000) RETURNING id",
      [eventId, a.id],
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/host/invoices/${rows[0].id}/confirm-payment`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    const after = await pool.query("SELECT status FROM invoices WHERE id = $1", [rows[0].id]);
    expect(after.rows[0].status).toBe("unpaid");
    expect(mailbox.sent).toHaveLength(0);
  });
});

describe("invoices after close", () => {
  it("are built from final winners only; outbid guests get none", async () => {
    const { code, eventId, items, a, b } = await setup();
    // A leads both items, then B overtakes the villa.
    expect((await bid(app, code, a.token, items[0].id, 1000)).statusCode).toBe(200);
    expect((await bid(app, code, a.token, items[1].id, 2000)).statusCode).toBe(200);
    expect((await bid(app, code, b.token, items[1].id, 2200)).statusCode).toBe(200);
    await closeEvent(eventId);

    const ia = (await guestInvoice(code, a.token)).json();
    expect(ia.invoice.total).toBe(1000);
    expect(ia.invoice.lines.map((l: { title: string }) => l.title)).toEqual(["Watch"]);

    const ib = (await guestInvoice(code, b.token)).json();
    expect(ib.invoice.total).toBe(2200);
    expect(ib.invoice.lines.map((l: { title: string }) => l.title)).toEqual(["Villa"]);
  });

  it("removes stale unpaid invoices of guests who no longer win (created mid-auction by an older version)", async () => {
    const { code, eventId, items, a, b } = await setup();
    expect((await bid(app, code, a.token, items[0].id, 1000)).statusCode).toBe(200);
    expect((await bid(app, code, b.token, items[0].id, 1100)).statusCode).toBe(200);
    const stale = await pool.query(
      "INSERT INTO invoices (event_id, guest_id, total) VALUES ($1, $2, 1000) RETURNING id",
      [eventId, a.id],
    );
    await pool.query("INSERT INTO invoice_lines (invoice_id, item_id, amount) VALUES ($1, $2, 1000)", [
      stale.rows[0].id,
      items[0].id,
    ]);
    await closeEvent(eventId);

    const ia = (await guestInvoice(code, a.token)).json();
    expect(ia.invoice).toBeNull();
    const host = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
    expect(host.invoices).toHaveLength(1);
    expect(host.invoices[0]).toMatchObject({ guestEmail: "b@example.org", total: 1100 });
  });

  it("handles many winners opening their invoice at the same moment", async () => {
    const ev = await createOpenEvent(
      app,
      cookie,
      Array.from({ length: 6 }, (_, i) => ({ title: `Lot ${i + 1}`, startingBid: 100, minIncrement: 10 })),
    );
    const guests = await Promise.all(
      ev.items.map((_, i) => joinGuest(app, ev.code, `w${i}@example.org`)),
    );
    for (let i = 0; i < guests.length; i++) {
      expect((await bid(app, ev.code, guests[i].token, ev.items[i].id, 100)).statusCode).toBe(200);
    }
    await closeEvent(ev.eventId);
    const results = await Promise.all(guests.map((g) => guestInvoice(ev.code, g.token)));
    expect(results.map((r) => r.statusCode)).toEqual(guests.map(() => 200));
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM invoices");
    expect(rows[0].c).toBe(6);
  });

  it("payslip upload, then host confirm emails the vouchers", async () => {
    const { code, eventId, items, a } = await setup();
    expect((await bid(app, code, a.token, items[0].id, 1000)).statusCode).toBe(200);
    await closeEvent(eventId);

    expect((await uploadPayslip(code, a.token)).statusCode).toBe(200);
    const host = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
    expect(host.invoices[0]).toMatchObject({ status: "payslip_uploaded", hasPayslip: true });

    const confirm = await app.inject({
      method: "POST",
      url: `/api/host/invoices/${host.invoices[0].id}/confirm-payment`,
      headers: { cookie },
    });
    expect(confirm.statusCode).toBe(200);
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0].to).toBe("a@example.org");
  });
});
