import { createHash, randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { pool } from "./db.js";
import { sendMail, smtpConfigured } from "./mail.js";
import { safeEqual } from "./hostAuth.js";
import { isKnownDevice } from "./devices.js";
import { maskEmail, normalizePhone } from "./phone.js";

export type GuestRow = {
  id: string;
  event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  token: string;
  claimed_at?: Date | null;
  /** Per-event running number; the public default name is "Guest <guest_no>". */
  guest_no?: number | null;
  /** Name or company as it should appear on a donation receipt. */
  receipt_name?: string | null;
};

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

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

export function requirePhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone) throw httpError(400, "Please enter a valid phone number");
  return phone;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return e || null;
}

/** Public default name: a neutral per-event number, never phone digits or email. */
export function defaultGuestName(guestNo: number | null | undefined): string {
  return guestNo ? `Guest ${guestNo}` : "Guest";
}

/** Chosen name, trimmed; "" means "use the default" (the DB trigger fills "Guest <n>"). */
function cleanName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
}

async function findByPhone(eventId: string, phone: string): Promise<GuestRow | undefined> {
  const { rows } = await pool.query("SELECT * FROM guests WHERE event_id = $1 AND phone = $2", [eventId, phone]);
  return rows[0] as GuestRow | undefined;
}

/**
 * Host-side add/update (trusted), keyed by phone. If an older email-only guest has the given
 * email, the phone is attached to that guest. New guests stay unclaimed until they join.
 */
export async function upsertGuest(
  eventId: string,
  phoneRaw: string,
  name: string,
  emailRaw?: string | null,
): Promise<GuestRow> {
  const phone = requirePhone(phoneRaw);
  const email = normalizeEmail(emailRaw);
  let row = await findByPhone(eventId, phone);
  if (!row && email) {
    const legacy = await pool.query(
      "SELECT * FROM guests WHERE event_id = $1 AND phone IS NULL AND lower(email) = $2 LIMIT 1",
      [eventId, email],
    );
    if (legacy.rows[0]) {
      const upd = await pool.query("UPDATE guests SET phone = $1 WHERE id = $2 RETURNING *", [phone, legacy.rows[0].id]);
      row = upd.rows[0] as GuestRow;
    }
  }
  if (row) {
    const upd = await pool.query(
      `UPDATE guests SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
         email = COALESCE($3, email)
       WHERE id = $1 RETURNING *`,
      [row.id, name.trim(), email],
    );
    return upd.rows[0] as GuestRow;
  }
  const ins = await pool.query(
    `INSERT INTO guests (event_id, name, phone, email, token, claimed_at) VALUES ($1,$2,$3,$4,$5,NULL)
     ON CONFLICT (event_id, phone) WHERE phone IS NOT NULL
       DO UPDATE SET name = CASE WHEN $2 <> '' THEN $2 ELSE guests.name END
     RETURNING *`,
    [eventId, cleanName(name), phone, email, nanoid(24)],
  );
  return ins.rows[0] as GuestRow;
}

export type JoinResult =
  | { kind: "joined"; guest: GuestRow }
  | { kind: "code_sent"; phone: string; delivery: "email" | "desk"; maskedEmail: string | null; resendInSeconds: number };

type Log = { warn: (obj: unknown, msg?: string) => void };

/**
 * Guest self-join by phone. Hands out a guest token only when:
 *  - the phone is new for this event, or
 *  - the guest was added by the host and never claimed by a device, or
 *  - the request already carries this guest's token (same device), or
 *  - the request carries the token of an older email-only guest (the phone is attached to it), or
 *  - the request comes from a device this guest already authenticated on (device cookie).
 * Otherwise a 6-digit code is created: emailed if the guest has an email (and SMTP is set),
 * and always shown on the host help desk. Without SMTP/email it is also written to the log.
 */
export async function joinGuest(opts: {
  eventId: string;
  eventTitle: string;
  phone: string;
  name: string;
  email?: string | null;
  presentedToken: string;
  /** This browser's device id (httpOnly cookie), if any. */
  deviceId?: string | null;
  log: Log;
}): Promise<JoinResult> {
  const phone = requirePhone(opts.phone);
  const email = normalizeEmail(opts.email);

  if (opts.presentedToken) {
    const legacy = await pool.query(
      "SELECT * FROM guests WHERE token = $1 AND event_id = $2 AND phone IS NULL",
      [opts.presentedToken, opts.eventId],
    );
    if (legacy.rows[0] && !(await findByPhone(opts.eventId, phone))) {
      const upd = await pool.query(
        `UPDATE guests SET phone = $2, name = CASE WHEN $3 <> '' THEN $3 ELSE name END,
           email = COALESCE(email, $4), claimed_at = COALESCE(claimed_at, now())
         WHERE id = $1 RETURNING *`,
        [legacy.rows[0].id, phone, opts.name.trim(), email],
      );
      return { kind: "joined", guest: upd.rows[0] as GuestRow };
    }
  }

  // Look up first so re-joins don't burn guest numbers; the insert still guards against races.
  let row = await findByPhone(opts.eventId, phone);
  if (!row) {
    const inserted = await pool.query(
      `INSERT INTO guests (event_id, name, phone, email, token, claimed_at) VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (event_id, phone) WHERE phone IS NOT NULL DO NOTHING
       RETURNING *`,
      [opts.eventId, cleanName(opts.name), phone, email, nanoid(24)],
    );
    if (inserted.rows[0]) return { kind: "joined", guest: inserted.rows[0] as GuestRow };
    row = (await findByPhone(opts.eventId, phone))!;
  }

  if (opts.presentedToken && safeEqual(opts.presentedToken, row.token)) {
    return { kind: "joined", guest: await updateProfile(row, opts.name, email) };
  }

  if (!row.claimed_at) {
    const claimed = await pool.query(
      `UPDATE guests SET claimed_at = now(), name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
         email = COALESCE(email, $3)
       WHERE id = $1 AND claimed_at IS NULL RETURNING *`,
      [row.id, opts.name.trim(), email],
    );
    if (claimed.rows[0]) return { kind: "joined", guest: claimed.rows[0] as GuestRow };
  }

  // Same device as an earlier verified session (e.g. after "Not you? Log out"): no code needed.
  if (await isKnownDevice(row.id, opts.deviceId)) {
    return { kind: "joined", guest: await updateProfile(row, opts.name, email) };
  }

  // Note: an email typed on the new device is ignored here — the code only goes to the email on file.
  const sent = await issueCode(row, opts.eventTitle, opts.log);
  return {
    kind: "code_sent",
    phone,
    delivery: sent.delivery,
    maskedEmail: sent.delivery === "email" && row.email ? maskEmail(row.email) : null,
    resendInSeconds: sent.resendInSeconds,
  };
}

async function updateProfile(row: GuestRow, name: string, email: string | null): Promise<GuestRow> {
  const n = name.trim();
  if ((!n || n === row.name) && (!email || email === row.email)) return row;
  const upd = await pool.query(
    `UPDATE guests SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END, email = COALESCE($3, email)
     WHERE id = $1 RETURNING *`,
    [row.id, n, email],
  );
  return upd.rows[0] as GuestRow;
}

/** True when the guest chose a board name (not the default "Guest <n>"). */
export function hasChosenName(g: { name: string; guest_no?: number | null }): boolean {
  const n = g.name.trim();
  return n !== "" && n !== defaultGuestName(g.guest_no);
}

/** Guest sets their board name later (inline on the bid page). Empty → back to "Guest <n>". */
export async function setGuestName(guestId: string, nameRaw: string): Promise<GuestRow> {
  const name = cleanName(nameRaw);
  const upd = await pool.query(
    `UPDATE guests SET name = CASE WHEN $2 <> '' THEN $2 ELSE 'Guest ' || guest_no END WHERE id = $1 RETURNING *`,
    [guestId, name],
  );
  if (!upd.rows[0]) throw httpError(404, "Guest not found");
  return upd.rows[0] as GuestRow;
}

/** Name or company printed on a donation receipt. Empty clears it. */
export async function setGuestReceiptName(guestId: string, nameRaw: string): Promise<GuestRow> {
  const name = String(nameRaw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const upd = await pool.query("UPDATE guests SET receipt_name = $2 WHERE id = $1 RETURNING *", [
    guestId,
    name || null,
  ]);
  if (!upd.rows[0]) throw httpError(404, "Guest not found");
  await pool.query(
    `UPDATE invoices SET receipt_name = $2
     WHERE guest_id = $1 AND status <> 'paid'`,
    [guestId, name || null],
  );
  return upd.rows[0] as GuestRow;
}

/** Guest sets/changes their own email (e.g. at invoice time, to receive voucher PDFs). */
export async function setGuestEmail(guestId: string, emailRaw: string): Promise<GuestRow> {
  const email = normalizeEmail(emailRaw);
  if (!email) throw httpError(400, "Email required");
  const upd = await pool.query("UPDATE guests SET email = $2 WHERE id = $1 RETURNING *", [guestId, email]);
  return upd.rows[0] as GuestRow;
}

export function hashCode(guestId: string, code: string): string {
  return createHash("sha256").update(`${guestId}:${code}`, "utf8").digest("hex");
}

/** Creates (unless one was sent very recently) and delivers a code. */
async function issueCode(
  guest: GuestRow,
  eventTitle: string,
  log: Log,
): Promise<{ delivery: "email" | "desk"; resendInSeconds: number }> {
  const canEmail = Boolean(guest.email) && smtpConfigured();
  const recent = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS age, delivery
     FROM guest_login_codes
     WHERE guest_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [guest.id],
  );
  const age = recent.rows[0]?.age as number | undefined;
  if (age != null && age < CODE_RESEND_SECONDS) {
    return { delivery: recent.rows[0].delivery, resendInSeconds: CODE_RESEND_SECONDS - age };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const delivery = canEmail ? "email" : "desk";
  // Only the newest code is valid.
  await pool.query(
    "UPDATE guest_login_codes SET used_at = now(), desk_code = NULL WHERE guest_id = $1 AND used_at IS NULL",
    [guest.id],
  );
  await pool.query(
    `INSERT INTO guest_login_codes (guest_id, code_hash, desk_code, delivery, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [guest.id, hashCode(guest.id, code), code, delivery, CODE_TTL_MINUTES],
  );

  if (!canEmail) {
    log.warn(
      { guestPhone: guest.phone, event: eventTitle, code },
      "Guest login code not emailed (no guest email or SMTP) — shown on host help desk and logged here",
    );
    return { delivery, resendInSeconds: CODE_RESEND_SECONDS };
  }
  await sendMail({
    to: guest.email!,
    subject: `Your code for ${eventTitle}: ${code}`,
    text:
      `Hi ${guest.name},\n\n` +
      `Someone (hopefully you) wants to bid with phone ${guest.phone} at "${eventTitle}" on a new device.\n\n` +
      `Your code: ${code}\n\n` +
      `It expires in ${CODE_TTL_MINUTES} minutes. If this wasn't you, ignore this email — ` +
      `nobody can bid as you without this code.\n\n` +
      `— FlüsterLos\n`,
  });
  return { delivery, resendInSeconds: CODE_RESEND_SECONDS };
}

/** Pending codes for the host help desk (host checks the person, then reads the code out). */
export async function pendingLoginRequests(eventId: string) {
  const { rows } = await pool.query(
    `SELECT c.id, c.desk_code, c.delivery, c.created_at, c.expires_at, c.attempts,
            g.name, g.phone, g.email
     FROM guest_login_codes c
     JOIN guests g ON g.id = c.guest_id
     WHERE g.event_id = $1 AND c.used_at IS NULL AND c.expires_at > now() AND c.desk_code IS NOT NULL
     ORDER BY c.created_at DESC`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    code: r.desk_code as string,
    delivery: r.delivery as "email" | "desk",
    guestName: r.name as string,
    phone: r.phone as string | null,
    email: (r.email as string | null) ?? null,
    attempts: r.attempts as number,
    requestedAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  }));
}

export async function verifyGuestCode(opts: {
  eventId: string;
  phone: string;
  code: string;
  name: string;
}): Promise<GuestRow> {
  const phone = normalizePhone(opts.phone);
  const guest = phone ? await findByPhone(opts.eventId, phone) : undefined;
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
           used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END,
           desk_code = CASE WHEN attempts + 1 >= $2 THEN NULL ELSE desk_code END
         WHERE id = $1`,
        [row.id, CODE_MAX_ATTEMPTS],
      );
      await client.query("COMMIT");
      throw httpError(400, "Invalid or expired code");
    }
    await client.query("UPDATE guest_login_codes SET used_at = now(), desk_code = NULL WHERE id = $1", [row.id]);
    await client.query("UPDATE guests SET claimed_at = COALESCE(claimed_at, now()) WHERE id = $1", [guest.id]);
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
  return updateProfile(guest, opts.name, null);
}

/** Opaque, per-event key for "is this guest the current leader" without exposing guest ids. */
export function leaderKey(eventId: string, guestId: string): string {
  return createHash("sha256").update(`leader:${eventId}:${guestId}`).digest("hex").slice(0, 16);
}
