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
