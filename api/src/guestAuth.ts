import { nanoid } from "nanoid";
import { pool } from "./db.js";

export type GuestRow = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  token: string;
};

export async function guestFromRequest(req: {
  headers: Record<string, unknown>;
  cookies?: Record<string, string>;
}): Promise<GuestRow | null> {
  const header = String(req.headers["x-guest-token"] ?? "");
  const cookieToken = req.cookies?.fl_guest ?? "";
  const token = header || cookieToken;
  if (!token) return null;
  const { rows } = await pool.query("SELECT * FROM guests WHERE token = $1", [token]);
  return (rows[0] as GuestRow | undefined) ?? null;
}

export async function upsertGuest(
  eventId: string,
  email: string,
  name: string,
): Promise<GuestRow> {
  const normalized = email.trim().toLowerCase();
  const display = name.trim() || normalized.split("@")[0] || "Guest";
  const existing = await pool.query(
    "SELECT * FROM guests WHERE event_id = $1 AND lower(email) = $2",
    [eventId, normalized],
  );
  const row = existing.rows[0] as GuestRow | undefined;
  if (row) {
    if (display && display !== row.name) {
      await pool.query("UPDATE guests SET name = $1 WHERE id = $2", [display, row.id]);
      return { ...row, name: display };
    }
    return row;
  }
  const token = nanoid(24);
  const ins = await pool.query(
    `INSERT INTO guests (event_id, name, email, token) VALUES ($1,$2,$3,$4) RETURNING *`,
    [eventId, display, normalized, token],
  );
  return ins.rows[0] as GuestRow;
}
