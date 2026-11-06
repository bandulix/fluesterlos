import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

export const SESSION_COOKIE = "fl_host_session";
const SESSION_DAYS = 14;
const BCRYPT_ROUNDS = 12;

export type HostUser = {
  id: string;
  email: string;
  role: string;
};

function unauthorized(): Error {
  const err = new Error("Unauthorized");
  (err as Error & { statusCode?: number }).statusCode = 401;
  return err;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Timing-safe string compare via equal-length digests. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function cookieSecure(publicUrl: string): boolean {
  return publicUrl.trim().toLowerCase().startsWith("https://");
}

export async function countHostUsers(client?: Pick<typeof pool, "query">): Promise<number> {
  const q = client ?? pool;
  const { rows } = await q.query("SELECT COUNT(*)::int AS c FROM host_users");
  return rows[0].c as number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function createSession(
  hostUserId: string,
  reply: FastifyReply,
  publicUrl: string,
): Promise<void> {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO host_sessions (host_user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [hostUserId, tokenHash, expiresAt.toISOString()],
  );
  reply.setCookie(SESSION_COOKIE, raw, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(publicUrl),
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    await pool.query("DELETE FROM host_sessions WHERE token_hash = $1", [hashToken(raw)]);
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function hostFromRequest(req: FastifyRequest): Promise<HostUser | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const { rows } = await pool.query(
    `SELECT hu.id, hu.email, hu.role
     FROM host_sessions hs
     JOIN host_users hu ON hu.id = hs.host_user_id
     WHERE hs.token_hash = $1 AND hs.expires_at > now()`,
    [hashToken(raw)],
  );
  const row = rows[0] as HostUser | undefined;
  return row ?? null;
}

export async function requireHost(req: FastifyRequest): Promise<HostUser> {
  const host = await hostFromRequest(req);
  if (!host) throw unauthorized();
  return host;
}

/** First-owner register: bootstrap token + transactional insert only if zero hosts. */
export async function registerOwner(
  email: string,
  password: string,
  bootstrapToken: string,
  expectedBootstrap: string,
): Promise<HostUser> {
  if (!expectedBootstrap || !safeEqual(bootstrapToken, expectedBootstrap)) {
    const err = new Error("Invalid bootstrap token");
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN");
    begun = true;
    await client.query("LOCK TABLE host_users IN EXCLUSIVE MODE");
    const count = await countHostUsers(client);
    if (count > 0) {
      const err = new Error("Registration closed: an owner already exists");
      (err as Error & { statusCode?: number }).statusCode = 409;
      throw err;
    }
    const { rows } = await client.query(
      `INSERT INTO host_users (email, password_hash, role)
       VALUES ($1, $2, 'owner')
       RETURNING id, email, role`,
      [email, passwordHash],
    );
    await client.query("COMMIT");
    begun = false;
    return rows[0] as HostUser;
  } catch (e) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* */
      }
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function requireOwner(req: FastifyRequest): Promise<HostUser> {
  const host = await requireHost(req);
  if (host.role !== "owner") {
    const err = new Error("Owner only");
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return host;
}

export async function listHostUsers(): Promise<Array<HostUser & { createdAt: string }>> {
  const { rows } = await pool.query(
    "SELECT id, email, role, created_at FROM host_users ORDER BY lower(email)",
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addHostUser(email: string, password: string): Promise<HostUser> {
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO host_users (email, password_hash, role)
       VALUES ($1, $2, 'host')
       RETURNING id, email, role`,
      [email.trim().toLowerCase(), passwordHash],
    );
    return rows[0] as HostUser;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      const conflict = new Error("That email is already a host");
      (conflict as Error & { statusCode?: number }).statusCode = 409;
      throw conflict;
    }
    throw e;
  }
}

const INVITE_DAYS = 7;

export async function createAdminInvite(email: string, invitedBy: string, publicUrl: string) {
  const normalised = email.trim().toLowerCase();
  const existing = await pool.query("SELECT id FROM host_users WHERE lower(email) = $1", [normalised]);
  if (existing.rows[0]) {
    const err = new Error("That email already has a login");
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }
  const raw = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  await pool.query("DELETE FROM admin_invites WHERE lower(email) = $1 AND accepted_at IS NULL", [normalised]);
  const { rows } = await pool.query(
    `INSERT INTO admin_invites (email, role, token_hash, invited_by, expires_at)
     VALUES ($1, 'admin', $2, $3, $4)
     RETURNING id, email, role, expires_at`,
    [normalised, hashToken(raw), invitedBy, expiresAt.toISOString()],
  );
  const row = rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    role: row.role as string,
    expiresAt: new Date(row.expires_at as Date).toISOString(),
    acceptUrl: `${publicUrl.replace(/\/$/, "")}/host/invite/${raw}`,
  };
}

export async function listAdminInvites() {
  const { rows } = await pool.query(
    `SELECT id, email, role, expires_at, accepted_at, created_at
     FROM admin_invites ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as string,
    expiresAt: new Date(r.expires_at as Date).toISOString(),
    acceptedAt: r.accepted_at ? new Date(r.accepted_at as Date).toISOString() : null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }));
}

export async function acceptAdminInvite(token: string, password: string): Promise<HostUser> {
  const { rows } = await pool.query(
    `SELECT id, email, role FROM admin_invites
     WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  const invite = rows[0] as { id: string; email: string; role: string } | undefined;
  if (!invite) {
    const err = new Error("This invite is invalid or has expired");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO host_users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role`,
      [invite.email, passwordHash],
    );
    await client.query("UPDATE admin_invites SET accepted_at = now() WHERE id = $1", [invite.id]);
    await client.query("COMMIT");
    return inserted.rows[0] as HostUser;
  } catch (e) {
    await client.query("ROLLBACK");
    const err = e as { code?: string };
    if (err.code === "23505") {
      const conflict = new Error("That email already has a login");
      (conflict as Error & { statusCode?: number }).statusCode = 409;
      throw conflict;
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function removeHostUser(id: string, actorId: string): Promise<void> {
  if (id === actorId) {
    const err = new Error("You cannot remove your own login");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const { rowCount } = await pool.query(
    "DELETE FROM host_users WHERE id = $1 AND role <> 'owner'",
    [id],
  );
  if (!rowCount) {
    const err = new Error("Host not found or cannot be removed");
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
}

export async function loginHost(email: string, password: string): Promise<HostUser> {
  const { rows } = await pool.query(
    "SELECT id, email, role, password_hash FROM host_users WHERE lower(email) = lower($1)",
    [email],
  );
  const row = rows[0] as
    | { id: string; email: string; role: string; password_hash: string }
    | undefined;
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    const err = new Error("Invalid email or password");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
  return { id: row.id, email: row.email, role: row.role };
}
