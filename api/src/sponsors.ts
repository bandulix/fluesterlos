import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { contentTypeFor, readDataFile, saveUpload } from "./storage.js";

export type SponsorDto = { id: string; name: string; logoUrl: string | null };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isImageFile(file: { filename: string; mimetype: string }) {
  return IMAGE_MIME.has((file.mimetype || "").toLowerCase()) || IMAGE_EXT.test(file.filename || "");
}

export function sponsorLogoUrl(id: string, logoPath: string | null | undefined): string | null {
  return logoPath ? `/api/sponsors/${id}/logo` : null;
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Sponsors are shared across items and events, matched by name (case-insensitive).
 * A new logo replaces the old one; no logo keeps the existing one.
 */
export async function upsertSponsor(
  nameRaw: string,
  logo?: { filename: string; mimetype: string; buffer: Buffer } | null,
): Promise<SponsorDto> {
  const name = nameRaw.trim().slice(0, 200);
  if (!name) throw httpError(400, "Sponsor name required");
  if (logo && !isImageFile(logo)) throw httpError(400, "Sponsor logo must be jpg, png, webp, or gif");
  const { rows } = await pool.query(
    `INSERT INTO sponsors (name) VALUES ($1)
     ON CONFLICT (lower(name)) DO UPDATE SET name = sponsors.name
     RETURNING id, name, logo_path`,
    [name],
  );
  let row = rows[0] as { id: string; name: string; logo_path: string | null };
  if (logo) {
    const rel = await saveUpload("sponsors", logo.filename, logo.buffer, row.id);
    const upd = await pool.query(
      "UPDATE sponsors SET logo_path = $2 WHERE id = $1 RETURNING id, name, logo_path",
      [row.id, rel],
    );
    row = upd.rows[0];
  }
  return { id: row.id, name: row.name, logoUrl: sponsorLogoUrl(row.id, row.logo_path) };
}

export function registerSponsorRoutes(
  app: FastifyInstance,
  deps: { requireHost: (req: FastifyRequest) => Promise<unknown> },
) {
  app.get("/api/host/sponsors", async (req, reply) => {
    try { await deps.requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.logo_path,
         (SELECT COUNT(*)::int FROM items i WHERE i.sponsor_id = s.id) AS item_count
       FROM sponsors s ORDER BY lower(s.name)`,
    );
    return {
      sponsors: rows.map((r) => ({
        id: r.id,
        name: r.name,
        logoUrl: sponsorLogoUrl(r.id, r.logo_path),
        itemCount: r.item_count,
      })),
    };
  });

  /** Multipart: name (required), logo (optional image). Creates or updates by name. */
  app.post("/api/host/sponsors", async (req, reply) => {
    try { await deps.requireHost(req); } catch { return reply.code(401).send({ error: "Unauthorized" }); }
    if (!req.isMultipart?.()) return reply.code(400).send({ error: "multipart required: name (+ optional logo)" });
    let name = "";
    let logo: { filename: string; mimetype: string; buffer: Buffer } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        logo = { filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() };
      } else if (part.fieldname === "name") {
        name = String(part.value ?? "");
      }
    }
    return { sponsor: await upsertSponsor(name, logo) };
  });

  app.get("/api/sponsors/:id/logo", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: "Not found" });
    const { rows } = await pool.query("SELECT logo_path FROM sponsors WHERE id = $1", [id]);
    const rel = rows[0]?.logo_path as string | undefined;
    if (!rel) return reply.code(404).send({ error: "No logo" });
    const buf = await readDataFile(rel);
    return reply.header("Cache-Control", "public, max-age=300").type(contentTypeFor(rel)).send(buf);
  });
}
