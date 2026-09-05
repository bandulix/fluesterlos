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
