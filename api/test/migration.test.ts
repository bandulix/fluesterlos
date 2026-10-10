import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pool, migrate } from "../src/db.js";
import { buildApp } from "../src/app.js";

afterAll(async () => {
  // Leave a clean, current schema for the next test file.
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  await pool.end();
});

describe("upgrade from v0.2.0", () => {
  it("migrates an email-keyed v0.2.0 database idempotently; old guests keep working", async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await pool.query(readFileSync(path.join(import.meta.dirname, "fixtures/schema-v0.2.0.sql"), "utf8"));
    const ev = await pool.query(
      `INSERT INTO events (code, title, starts_at, ends_at, currency)
       VALUES ('oldevent', 'Old', now() - interval '1 hour', now() + interval '1 hour', 'THB') RETURNING id`,
    );
    const eventId = ev.rows[0].id;
    const item = await pool.query(
      `INSERT INTO items (event_id, title, starting_bid, min_increment, voucher_pdf_path)
       VALUES ($1, 'Old voucher', 100, 10, 'vouchers/x.pdf') RETURNING id`,
      [eventId],
    );
    await pool.query(
      "INSERT INTO guests (event_id, name, email, token) VALUES ($1, 'Olga', 'olga@example.org', 'legacy-token-000000000000')",
      [eventId],
    );

    await migrate();
    await migrate(); // idempotent

    const kind = await pool.query("SELECT kind, sponsor_id FROM items WHERE id = $1", [item.rows[0].id]);
    expect(kind.rows[0]).toEqual({ kind: "voucher", sponsor_id: null });

    const app = await buildApp({ logger: false });
    await app.ready();
    try {
      // Old token still bids.
      const bid = await app.inject({
        method: "POST",
        url: "/api/events/oldevent/bids",
        headers: { "x-guest-token": "legacy-token-000000000000" },
        payload: { itemId: item.rows[0].id, amount: 100 },
      });
      expect(bid.statusCode).toBe(200);
      // Joining by phone on the same device attaches the phone to the old guest.
      const join = await app.inject({
        method: "POST",
        url: "/api/events/oldevent/join",
        headers: { "x-guest-token": "legacy-token-000000000000" },
        payload: { phone: "0810000077" },
      });
      expect(join.statusCode).toBe(200);
      expect(join.json().guest).toMatchObject({ name: "Olga", email: "olga@example.org", phone: "+66810000077" });
      // Two guests may now share an email (e.g. a couple), keyed by different phones.
      const second = await app.inject({
        method: "POST",
        url: "/api/events/oldevent/join",
        payload: { phone: "0810000078", email: "olga@example.org" },
      });
      expect(second.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
