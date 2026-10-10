import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";

/**
 * Allowed browser origins for credentialed CORS.
 * CORS_ORIGINS: comma-separated origins (e.g. "https://auction.example.org,http://localhost:5173").
 * "*" reflects any origin (old behaviour, not recommended). Default: the origin of PUBLIC_URL.
 */
export function allowedOrigins(publicUrl: string): string[] | "*" {
  const raw = (process.env.CORS_ORIGINS ?? "").trim();
  if (raw === "*") return "*";
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [publicUrl];
  return list
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function corsOriginOption(publicUrl: string): boolean | string[] {
  const allowed = allowedOrigins(publicUrl);
  return allowed === "*" ? true : allowed;
}

export function isAllowedOrigin(origin: string | undefined, publicUrl: string): boolean {
  if (!origin) return false;
  const allowed = allowedOrigins(publicUrl);
  return allowed === "*" || allowed.includes(origin);
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bodyEmail(req: FastifyRequest): string {
  const body = req.body as { email?: unknown } | undefined;
  return String(body?.email ?? "").trim().toLowerCase();
}

function guestKey(req: FastifyRequest): string {
  const header = String(req.headers["x-guest-token"] ?? "");
  const cookieToken = req.cookies?.fl_guest ?? "";
  return header || cookieToken || `ip:${req.ip}`;
}

export type RateLimitKind = "join" | "verify" | "bid" | "hostLogin";

/** Per-route rate-limit config. Keys avoid plain-IP limits where possible: venue Wi-Fi puts many guests behind one IP. */
export function rateLimitFor(kind: RateLimitKind) {
  switch (kind) {
    case "join":
      return {
        rateLimit: {
          max: envInt("RATE_LIMIT_JOIN_PER_MIN", 10),
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => `join:${req.ip}:${bodyEmail(req)}`,
        },
      };
    case "verify":
      return {
        rateLimit: {
          max: envInt("RATE_LIMIT_VERIFY_PER_10MIN", 10),
          timeWindow: "10 minutes",
          keyGenerator: (req: FastifyRequest) => `verify:${req.ip}:${bodyEmail(req)}`,
        },
      };
    case "bid":
      return {
        rateLimit: {
          max: envInt("RATE_LIMIT_BID_PER_10S", 20),
          timeWindow: "10 seconds",
          keyGenerator: (req: FastifyRequest) => `bid:${guestKey(req)}`,
        },
      };
    case "hostLogin":
      return {
        rateLimit: {
          max: envInt("RATE_LIMIT_LOGIN_PER_MIN", 10),
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => `login:${req.ip}:${bodyEmail(req)}`,
        },
      };
  }
}

export async function registerRateLimit(app: FastifyInstance) {
  // global: false → only routes that opt in via `config: rateLimitFor(...)` are limited.
  // preHandler hook so the parsed body (email) is available to key generators.
  await app.register(rateLimit, {
    global: false,
    hook: "preHandler",
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new Error(`Too many requests — try again in ${Math.ceil(ctx.ttl / 1000)}s`), {
        statusCode: ctx.statusCode,
      }),
  });
}
