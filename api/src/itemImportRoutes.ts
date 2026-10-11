import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pool } from "./db.js";
import { auctionStatus } from "./auction.js";
import { publish } from "./sse.js";
import { contentTypeFor, DATA_DIR, saveUpload } from "./storage.js";
import { upsertSponsor } from "./sponsors.js";
import {
  autoMapping,
  buildTemplate,
  expandDrafts,
  FIELD_LABELS,
  IMPORT_FIELDS,
  ImportField,
  ImportRow,
  Mapping,
  normalizeRows,
  parseImportFile,
  RawTable,
  RowOverride,
  summarize,
} from "./itemImport.js";

type EventRow = { id: string; code: string; starts_at: Date; ends_at: Date };
type LiveBuilder = (eventId: string, code: string) => Promise<unknown>;

/** Stored between preview and import (DATA_DIR/imports/<id>/), images as files next to it. */
type StoredImage = { name: string; ext: string; hash: string };
type Session = {
  id: string;
  eventId: string;
  fileName: string;
  createdAt: number;
  table: Omit<RawTable, "images"> & { images: Record<number, { photo?: StoredImage; logo?: StoredImage }> };
};

const SESSION_TTL_MS = 24 * 60 * 60_000;
const importsDir = () => path.join(DATA_DIR, "imports");
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function cleanupOldSessions() {
  try {
    for (const d of await readdir(importsDir())) {
      const p = path.join(importsDir(), d);
      const st = await stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > SESSION_TTL_MS) await rm(p, { recursive: true, force: true });
    }
  } catch {
    /* no imports yet */
  }
}

async function saveSession(table: RawTable, eventId: string, fileName: string): Promise<Session> {
  await cleanupOldSessions();
  const id = randomUUID();
  const dir = path.join(importsDir(), id);
  await mkdir(path.join(dir, "images"), { recursive: true });
  const images: Session["table"]["images"] = {};
  for (const [row, imgs] of Object.entries(table.images)) {
    const entry: { photo?: StoredImage; logo?: StoredImage } = {};
    for (const k of ["photo", "logo"] as const) {
      const im = imgs[k];
      if (!im) continue;
      await writeFile(path.join(dir, "images", im.name), im.buffer);
      entry[k] = { name: im.name, ext: im.ext, hash: im.hash };
    }
    images[Number(row)] = entry;
  }
  const session: Session = { id, eventId, fileName, createdAt: Date.now(), table: { ...table, images } };
  await writeFile(path.join(dir, "session.json"), JSON.stringify(session));
  return session;
}

async function loadSession(id: string): Promise<Session | null> {
  if (!isUuid(id)) return null;
  try {
    const s = JSON.parse(await readFile(path.join(importsDir(), id, "session.json"), "utf8")) as Session;
    return Date.now() - s.createdAt > SESSION_TTL_MS ? null : s;
  } catch {
    return null;
  }
}

/** The normalizer only needs image presence/hashes; buffers stay on disk. */
function tableForNormalize(s: Session): RawTable {
  const images: RawTable["images"] = {};
  for (const [row, imgs] of Object.entries(s.table.images)) {
    images[Number(row)] = {
      photo: imgs.photo && { ...imgs.photo, buffer: Buffer.alloc(0) },
      logo: imgs.logo && { ...imgs.logo, buffer: Buffer.alloc(0) },
    };
  }
  return { ...s.table, images };
}

const mappingSchema = z.array(z.enum(IMPORT_FIELDS).nullable()).max(200);
const overrideSchema = z.object({
  skip: z.boolean().optional(),
  kind: z.enum(["voucher", "physical"]).optional(),
  title: z.string().max(200).optional(),
  startingBid: z.number().positive().nullable().optional(),
  increment: z.number().positive().nullable().optional(),
  buyNow: z.number().positive().nullable().optional(),
});
const bodySchema = z.object({
  mapping: mappingSchema.optional(),
  overrides: z.record(z.string(), overrideSchema).optional(),
});

function cleanMapping(m: Mapping | undefined, width: number, fallback: Mapping): Mapping {
  if (!m) return fallback;
  const used = new Set<ImportField>();
  return Array.from({ length: width }, (_, i) => {
    const f = m[i] ?? null;
    if (!f || f === "ignore") return f;
    if (used.has(f)) return null; // one column per field
    used.add(f);
    return f;
  });
}

async function eventLock(eventId: string, ev: EventRow): Promise<string | null> {
  const bids = await pool.query(
    "SELECT COUNT(*)::int AS c FROM bids b JOIN items i ON i.id = b.item_id WHERE i.event_id = $1",
    [eventId],
  );
  if (bids.rows[0].c > 0) return "This auction already has bids — items can only be imported before bidding starts.";
  if (auctionStatus(ev.starts_at, ev.ends_at) === "closed") return "This auction is closed — reopen it (or create a new event) to import items.";
  return null;
}

export function registerItemImportRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    buildLivePayload: LiveBuilder;
    requireHost: (req: FastifyRequest) => Promise<unknown>;
  },
) {
  const { codeOf, getEventByCode, buildLivePayload, requireHost } = deps;

  async function hostAndEvent(req: FastifyRequest, reply: FastifyReply) {
    try {
      await requireHost(req);
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) {
      reply.code(404).send({ error: "Event not found" });
      return null;
    }
    return event;
  }

  async function preview(session: Session, event: EventRow, mapping: Mapping, overrides: Record<number, RowOverride>) {
    const table = tableForNormalize(session);
    const { rows, droppedTotals } = normalizeRows(table, mapping, overrides);
    const sponsorNames = [...new Set(rows.map((r) => r.sponsor?.toLowerCase()).filter(Boolean))] as string[];
    const existing = sponsorNames.length
      ? new Set(
          (await pool.query("SELECT lower(name) AS n FROM sponsors WHERE lower(name) = ANY($1)", [sponsorNames])).rows.map(
            (r) => r.n as string,
          ),
        )
      : new Set<string>();
    const img = (row: number, k: "photo" | "logo") => {
      const im = session.table.images[row]?.[k];
      return im ? `/api/host/import/${session.id}/images/${im.name}` : null;
    };
    const countRes = await pool.query("SELECT COUNT(*)::int AS c FROM items WHERE event_id = $1", [event.id]);
    return {
      sessionId: session.id,
      fileName: session.fileName,
      sheetName: session.table.sheetName,
      skippedSheets: session.table.skippedSheets,
      headerRow: session.table.headerRow,
      columns: session.table.headers.map((header, index) => ({
        index,
        header,
        field: mapping[index] ?? null,
        samples: session.table.rows
          .map((r) => r.cells[index])
          .filter((c) => c && (c.err || (c.v != null && String(c.v).trim() !== "")))
          .slice(0, 2)
          .map((c) => (c!.err ? c!.err : String(c!.v).replace(/\s+/g, " ").slice(0, 40))),
      })),
      fields: IMPORT_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] })),
      mapping,
      rows: rows.map((r: ImportRow) => ({
        ...r,
        photoUrl: r.hasPhoto ? img(r.key, "photo") : null,
        logoUrl: r.hasLogo ? img(r.key, "logo") : null,
        sponsorIsNew: r.sponsor ? !existing.has(r.sponsor.toLowerCase()) : false,
      })),
      droppedTotals,
      summary: summarize(rows),
      existingItems: countRes.rows[0].c as number,
      locked: await eventLock(event.id, event),
    };
  }

  /** Host-only item notes (never in the public live payload): { notes: { [itemId]: text } }. */
  app.get("/api/host/events/:code/item-notes", async (req, reply) => {
    const event = await hostAndEvent(req, reply);
    if (!event) return;
    const { rows } = await pool.query("SELECT id, notes FROM items WHERE event_id = $1 AND notes <> ''", [event.id]);
    return { notes: Object.fromEntries(rows.map((r) => [r.id as string, r.notes as string])) };
  });

  /** Blank template with the expected columns (and a "How to" sheet). */
  app.get("/api/host/import/template.xlsx", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply
      .header("Content-Disposition", 'attachment; filename="fluesterlos-items-template.xlsx"')
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(await buildTemplate());
  });

  /** Step 1: upload .xlsx / .csv → preview (nothing is created yet). */
  app.post("/api/host/events/:code/import", async (req, reply) => {
    const event = await hostAndEvent(req, reply);
    if (!event) return;
    if (!req.isMultipart?.()) return reply.code(400).send({ error: "Upload an .xlsx or .csv file (multipart field “file”)." });
    let file: { filename: string; buffer: Buffer } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file" && !file) file = { filename: part.filename, buffer: await part.toBuffer() };
      else if (part.type === "file") await part.toBuffer();
    }
    if (!file || file.buffer.length === 0) return reply.code(400).send({ error: "No file received." });
    const table = await parseImportFile(file.filename, file.buffer);
    const session = await saveSession(table, event.id, file.filename);
    return preview(session, event, autoMapping(table.headers), {});
  });

  /** Step 2 (repeatable): changed column mapping or row edits → fresh preview. */
  app.post("/api/host/events/:code/import/:sessionId/preview", async (req, reply) => {
    const event = await hostAndEvent(req, reply);
    if (!event) return;
    const session = await loadSession((req.params as { sessionId: string }).sessionId);
    if (!session || session.eventId !== event.id) return reply.code(404).send({ error: "This import expired — upload the file again." });
    const body = bodySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const fallback = autoMapping(session.table.headers);
    const mapping = cleanMapping(body.data.mapping, session.table.headers.length, fallback);
    const overrides = Object.fromEntries(Object.entries(body.data.overrides ?? {}).map(([k, v]) => [Number(k), v]));
    return preview(session, event, mapping, overrides);
  });

  app.get("/api/host/import/:sessionId/images/:name", async (req, reply) => {
    try {
      await requireHost(req);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { sessionId, name } = req.params as { sessionId: string; name: string };
    if (!isUuid(sessionId) || !/^[0-9a-f]{12}\.(jpg|png|gif|webp)$/.test(name)) return reply.code(404).send({ error: "Not found" });
    try {
      const buf = await readFile(path.join(importsDir(), sessionId, "images", name));
      return reply.header("Cache-Control", "private, max-age=3600").type(contentTypeFor(name)).send(buf);
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });

  /** Step 3: create the items (one per unit), reusing sponsors by name, attaching extracted photos. */
  app.post("/api/host/events/:code/import/:sessionId/commit", async (req, reply) => {
    const event = await hostAndEvent(req, reply);
    if (!event) return;
    const session = await loadSession((req.params as { sessionId: string }).sessionId);
    if (!session || session.eventId !== event.id) return reply.code(404).send({ error: "This import expired — upload the file again." });
    const body = bodySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const mapping = cleanMapping(body.data.mapping, session.table.headers.length, autoMapping(session.table.headers));
    const overrides = Object.fromEntries(Object.entries(body.data.overrides ?? {}).map(([k, v]) => [Number(k), v]));
    const { rows } = normalizeRows(tableForNormalize(session), mapping, overrides);
    const drafts = expandDrafts(rows);
    if (drafts.length === 0) return reply.code(400).send({ error: "Nothing to import — every row is skipped or needs a fix." });
    const locked = await eventLock(event.id, event);
    if (locked) return reply.code(409).send({ error: locked });

    // Sponsors first (idempotent upserts); a logo from the workbook only fills a missing logo.
    const sponsorIds = new Map<string, string>();
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    const dir = path.join(importsDir(), session.id, "images");
    for (const d of drafts) {
      if (!d.sponsor || sponsorIds.has(d.sponsor.toLowerCase())) continue;
      let sp = await upsertSponsor(d.sponsor);
      const logoImg = rowByKey.get(d.key)?.hasLogo ? session.table.images[d.key]?.logo : undefined;
      if (!sp.logoUrl && logoImg) {
        const buffer = await readFile(path.join(dir, logoImg.name)).catch(() => null);
        if (buffer) sp = await upsertSponsor(d.sponsor, { filename: logoImg.name, mimetype: `image/${logoImg.ext}`, buffer });
      }
      sponsorIds.set(d.sponsor.toLowerCase(), sp.id);
    }

    // One stored photo per spreadsheet row, shared by the units of a multi-unit lot.
    const photoPaths = new Map<number, string>();
    for (const key of new Set(drafts.map((d) => d.key))) {
      const im = session.table.images[key]?.photo;
      if (!im) continue;
      const buffer = await readFile(path.join(dir, im.name)).catch(() => null);
      if (buffer) photoPaths.set(key, await saveUpload("photos", im.name, buffer, `import-${im.hash}`));
    }

    const client = await pool.connect();
    const created: Array<{ id: string; title: string; lot: number }> = [];
    try {
      await client.query("BEGIN");
      // Same lock the bid route shares: no bid can land between the check and the insert.
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);
      const bids = await client.query(
        "SELECT 1 FROM bids b JOIN items i ON i.id = b.item_id WHERE i.event_id = $1 LIMIT 1",
        [event.id],
      );
      if (bids.rows.length) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This auction already has bids — items can only be imported before bidding starts." });
      }
      const base = await client.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n, COUNT(*)::int AS c FROM items WHERE event_id = $1",
        [event.id],
      );
      let sort = base.rows[0].n as number;
      let lot = base.rows[0].c as number;
      for (const d of drafts) {
        const ins = await client.query(
          `INSERT INTO items
             (event_id, title, description, photo_url, starting_bid, min_increment, buy_now, sort_order, kind, sponsor_id, retail_value, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            event.id,
            d.title,
            d.description,
            photoPaths.get(d.key) ?? null,
            d.startingBid,
            d.increment,
            d.buyNow,
            sort++,
            d.kind,
            d.sponsor ? sponsorIds.get(d.sponsor.toLowerCase()) ?? null : null,
            d.retailValue,
            d.notes,
          ],
        );
        created.push({ id: ins.rows[0].id, title: d.title, lot: ++lot });
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    await rm(path.join(importsDir(), session.id), { recursive: true, force: true }).catch(() => undefined);
    const live = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", live);
    return { created: created.length, items: created, live };
  });
}
