import { createHash, randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { sendMail, smtpConfigured } from "./mail.js";
import { safeEqual } from "./hostAuth.js";

export type GuestRow = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  token: string;
  claimed_at?: Date | null;
};

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;

export function tokenFromRequest(req: {
  headers: Record<string, unknown>;
  cookies?: Record<string, string | undefined>;
}): string {
  const header = String(req.headers["x-guest-token"] ?? "");
  const cookieToken = req.cookies?.fl_guest ?? "";
  return header || cookieToken;
}

export async function guestFromRequest(req: {
  headers: Record<string, unknown>;
  cookies?: Record<string, string | undefined>;
}): Promise<GuestRow | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const { rows } = await pool.query("SELECT * FROM guests WHERE token = $1", [token]);
  return (rows[0] as GuestRow | undefined) ?? null;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function displayName(name: string, normalizedEmail: string) {
  return name.trim() || normalizedEmail.split("@")[0] || "Guest";
}

/** Host-side add/update (trusted). New guests stay unclaimed until they join from a device. */
export async function upsertGuest(
  eventId: string,
  email: string,
  name: string,
): Promise<GuestRow> {
  const normalized = normalizeEmail(email);
  const display = displayName(name, normalized);
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
    `INSERT INTO guests (event_id, name, email, token, claimed_at) VALUES ($1,$2,$3,$4,NULL)
     ON CONFLICT (event_id, email) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [eventId, display, normalized, token],
  );
  return ins.rows[0] as GuestRow;
}

export type JoinResult =
  | { kind: "joined"; guest: GuestRow }
  | { kind: "code_sent"; email: string; resendInSeconds: number };

/**
 * Guest self-join. Hands out a guest token only when:
 *  - the email is new for this event, or
 *  - the guest was added by the host and never claimed by a device, or
 *  - the request already carries this guest's token (same device).
 * Otherwise a 6-digit code is emailed and must be confirmed via verifyGuestCode.
 */
export async function joinGuest(opts: {
  eventId: string;
  eventTitle: string;
  email: string;
  name: string;
  presentedToken: string;
  log: { warn: (obj: unknown, msg?: string) => void };
}): Promise<JoinResult> {
  const normalized = normalizeEmail(opts.email);
  const display = displayName(opts.name, normalized);

  const inserted = await pool.query(
    `INSERT INTO guests (event_id, name, email, token, claimed_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (event_id, email) DO NOTHING
     RETURNING *`,
    [opts.eventId, display, normalized, nanoid(24)],
  );
  if (inserted.rows[0]) return { kind: "joined", guest: inserted.rows[0] as GuestRow };

  const existing = await pool.query(
    "SELECT * FROM guests WHERE event_id = $1 AND lower(email) = $2",
    [opts.eventId, normalized],
  );
  const row = existing.rows[0] as GuestRow;

  if (opts.presentedToken && safeEqual(opts.presentedToken, row.token)) {
    return { kind: "joined", guest: await renameGuest(row, opts.name) };
  }

  if (!row.claimed_at) {
    const claimed = await pool.query(
      `UPDATE guests SET claimed_at = now(), name = $2 WHERE id = $1 AND claimed_at IS NULL RETURNING *`,
      [row.id, opts.name.trim() ? display : row.name],
    );
    if (claimed.rows[0]) return { kind: "joined", guest: claimed.rows[0] as GuestRow };
  }

  const resendInSeconds = await issueCode(row, opts.eventTitle, opts.log);
  return { kind: "code_sent", email: normalized, resendInSeconds };
}

async function renameGuest(row: GuestRow, name: string): Promise<GuestRow> {
  const display = name.trim();
  if (!display || display === row.name) return row;
  await pool.query("UPDATE guests SET name = $1 WHERE id = $2", [display, row.id]);
  return { ...row, name: display };
}

export function hashCode(guestId: string, code: string): string {
  return createHash("sha256").update(`${guestId}:${code}`, "utf8").digest("hex");
}

/** Creates and sends a code unless one was sent very recently. Returns seconds until a resend is allowed. */
async function issueCode(
  guest: GuestRow,
  eventTitle: string,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<number> {
  const recent = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS age
     FROM guest_login_codes
     WHERE guest_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [guest.id],
  );
  const age = recent.rows[0]?.age as number | undefined;
  if (age != null && age < CODE_RESEND_SECONDS) return CODE_RESEND_SECONDS - age;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Only the newest code is valid.
  await pool.query(
    "UPDATE guest_login_codes SET used_at = now() WHERE guest_id = $1 AND used_at IS NULL",
    [guest.id],
  );
  await pool.query(
    `INSERT INTO guest_login_codes (guest_id, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [guest.id, hashCode(guest.id, code), CODE_TTL_MINUTES],
  );

  if (!smtpConfigured()) {
    log.warn(
      { guestEmail: guest.email, event: eventTitle, code },
      "SMTP not configured — guest login code logged instead of emailed",
    );
    return CODE_RESEND_SECONDS;
  }
  await sendMail({
    to: guest.email,
    subject: `Your code for ${eventTitle}: ${code}`,
    text:
      `Hi ${guest.name},\n\n` +
      `Someone (hopefully you) wants to bid as ${guest.email} at "${eventTitle}" on a new device.\n\n` +
      `Your code: ${code}\n\n` +
      `It expires in ${CODE_TTL_MINUTES} minutes. If this wasn't you, ignore this email — ` +
      `nobody can bid as you without this code.\n\n` +
      `— FlüsterLos\n`,
  });
  return CODE_RESEND_SECONDS;
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export async function verifyGuestCode(opts: {
  eventId: string;
  email: string;
  code: string;
  name: string;
}): Promise<GuestRow> {
  const normalized = normalizeEmail(opts.email);
  const g = await pool.query(
    "SELECT * FROM guests WHERE event_id = $1 AND lower(email) = $2",
    [opts.eventId, normalized],
  );
  const guest = g.rows[0] as GuestRow | undefined;
  if (!guest) throw httpError(400, "Invalid or expired code");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = await client.query(
      `SELECT id, code_hash, attempts FROM guest_login_codes
       WHERE guest_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [guest.id],
    );
    const row = c.rows[0] as { id: string; code_hash: string; attempts: number } | undefined;
    if (!row || row.attempts >= CODE_MAX_ATTEMPTS) {
      await client.query("COMMIT");
      throw httpError(400, "Invalid or expired code — request a new one");
    }
    const ok = safeEqual(row.code_hash, hashCode(guest.id, opts.code.trim()));
    if (!ok) {
      await client.query(
        `UPDATE guest_login_codes SET attempts = attempts + 1,
           used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END
         WHERE id = $1`,
        [row.id, CODE_MAX_ATTEMPTS],
      );
      await client.query("COMMIT");
      throw httpError(400, "Invalid or expired code");
    }
    await client.query("UPDATE guest_login_codes SET used_at = now() WHERE id = $1", [row.id]);
    await client.query(
      "UPDATE guests SET claimed_at = COALESCE(claimed_at, now()) WHERE id = $1",
      [guest.id],
    );
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already committed */
    }
    throw e;
  } finally {
    client.release();
  }
  return renameGuest(guest, opts.name);
}
