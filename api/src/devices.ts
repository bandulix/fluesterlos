import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { cookieSecure } from "./hostAuth.js";

/**
 * Per-device marker for guests. A long-lived, httpOnly cookie holds a random id; the server
 * stores only its hash, per guest, after that guest authenticated on this device (new join,
 * claim, same token, code verified, or any request with a valid token). Joining again with the
 * same phone from a remembered device needs no code; any other device still does.
 * The id is never derived from the phone and can't be read by page scripts.
 */
export const DEVICE_COOKIE = "fl_device";
const DEVICE_MAX_AGE_S = 400 * 24 * 3600;
const DEVICE_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function deviceIdFrom(req: FastifyRequest): string | null {
  const raw = (req.cookies as Record<string, string | undefined> | undefined)?.[DEVICE_COOKIE] ?? "";
  return DEVICE_RE.test(raw) ? raw : null;
}

/** Returns this browser's device id, issuing one (Set-Cookie) when it has none yet. */
export function ensureDeviceId(req: FastifyRequest, reply: FastifyReply): string {
  const existing = deviceIdFrom(req);
  if (existing) return existing;
  const id = randomBytes(24).toString("base64url");
  reply.setCookie(DEVICE_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(process.env.PUBLIC_URL ?? "http://localhost:8080"),
    maxAge: DEVICE_MAX_AGE_S,
  });
  return id;
}

function deviceHash(deviceId: string): string {
  return createHash("sha256").update(`device:${deviceId}`).digest("hex");
}

export async function rememberDevice(guestId: string, deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  await pool.query(
    `INSERT INTO guest_devices (guest_id, device_hash) VALUES ($1, $2)
     ON CONFLICT (guest_id, device_hash) DO UPDATE SET last_seen_at = now()`,
    [guestId, deviceHash(deviceId)],
  );
}

export async function isKnownDevice(guestId: string, deviceId: string | null | undefined): Promise<boolean> {
  if (!deviceId) return false;
  const { rows } = await pool.query("SELECT 1 FROM guest_devices WHERE guest_id = $1 AND device_hash = $2", [
    guestId,
    deviceHash(deviceId),
  ]);
  return rows.length > 0;
}
