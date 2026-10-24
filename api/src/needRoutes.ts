import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { publish } from "./sse.js";
import { contentTypeFor, readDataFile, saveUpload } from "./storage.js";
import { guestFromRequest } from "./guestAuth.js";
import { rateLimitFor } from "./security.js";
import { parseCurrency } from "./auction.js";
import { insertExampleNeeds } from "./exampleNeeds.js";
import {
  correctPledge,
  hostPledgeBundle,
  listNeedRows,
  PLEDGE_UNDO_SECONDS,
  placePledge,
  toPublicNeed,
  undoPledge,
  voidPledge,
} from "./needs.js";
import { parseSuggestedAmounts } from "./pledges.js";
import { listDonationRoutes, setDonationRouteOverride } from "./donationRoute.js";
import { hostDonorBoard, moderateDonor, saveGuestRecognition } from "./recognition.js";
import type { HostUser } from "./hostAuth.js";

type EventRow = {
  id: string;
  code: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  currency?: string;
  needs_ends_at?: Date | null;
  spotlight_need_id?: string | null;
  donor_recognition?: boolean;
  top_donors_screen?: boolean;
  top_donors_limit?: number | string;
  spotlight_top_donors?: boolean;
};

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isImage(file: { filename: string; mimetype: string }) {
  const mime = (file.mimetype || "").toLowerCase();
  if (IMAGE_MIME.has(mime)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.filename || "");
}

const needBody = z.object({
  title: z.string().min(1).max(200),
  beneficiary: z.string().max(200).optional().default(""),
  description: z.string().max(5000).optional().default(""),
  targetAmount: z.number().positive(),
  minPledge: z.number().positive(),
  suggestedAmounts: z.array(z.number().positive()).max(8).optional(),
  unitLabel: z.string().max(40).nullable().optional(),
  unitAmount: z.number().positive().nullable().optional(),
  capAtTarget: z.boolean().optional().default(false),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  hidden: z.boolean().optional().default(false),
});

function cleanUnit(label: string | null | undefined, amount: number | null | undefined) {
  const unitLabel = label?.trim() ? label.trim() : null;
  const unitAmount = unitLabel && amount != null ? amount : null;
  if (unitLabel && !(unitAmount && unitAmount > 0)) {
    return { error: "A unit needs a price (for example one uniform is ฿800)" as const };
  }
  if (!unitLabel && amount != null) return { error: "Set a unit name to go with the unit price" as const };
  return { unitLabel, unitAmount };
}

export function registerNeedRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<EventRow | undefined>;
    buildLivePayload: (eventId: string, code: string) => Promise<unknown>;
    requireHost: (req: import("fastify").FastifyRequest) => Promise<HostUser>;
  },
) {
  const { codeOf, getEventByCode, buildLivePayload, requireHost } = deps;

  async function hostEvent(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
    let host: HostUser;
    try {
      host = await requireHost(req);
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    const code = codeOf((req.params as { code: string }).code);
    const event = await getEventByCode(code);
    if (!event) {
      reply.code(404).send({ error: "Event not found" });
      return null;
    }
    return { host, event };
  }

  app.get("/api/events/:code/needs/:needId/photo", async (req, reply) => {
    const { code, needId } = req.params as { code: string; needId: string };
    if (!z.string().uuid().safeParse(needId).success) return reply.code(404).send({ error: "No photo" });
    const event = await getEventByCode(codeOf(code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const { rows } = await pool.query(
      "SELECT photo_url, hidden FROM needs WHERE id = $1 AND event_id = $2",
      [needId, event.id],
    );
    const stored = rows[0]?.photo_url as string | null | undefined;
    if (!stored || rows[0].hidden) return reply.code(404).send({ error: "No photo" });
    if (/^https?:\/\//i.test(stored)) return reply.redirect(stored);
    const buf = await readDataFile(stored);
    return reply.header("Cache-Control", "public, max-age=86400").type(contentTypeFor(stored)).send(buf);
  });

  app.post("/api/events/:code/pledges", { config: rateLimitFor("bid") }, async (req, reply) => {
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const parsed = z
      .object({
        needId: z.string().uuid(),
        amount: z.number().positive().nullable().optional(),
        units: z.number().int().positive().nullable().optional(),
        anonymous: z.boolean().optional(),
        namedPublicly: z.boolean().optional(),
        publicName: z.string().max(80).optional(),
        showAmount: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check the amount and try again" });
    try {
      const placed = await placePledge({
        eventId: event.id,
        needId: parsed.data.needId,
        guestId: guest.id,
        guestName: guest.name,
        amount: parsed.data.amount,
        units: parsed.data.units,
        anonymous: parsed.data.anonymous,
        namedPublicly: parsed.data.namedPublicly,
        publicName: parsed.data.publicName,
        showAmount: parsed.data.showAmount,
        currency: event.currency,
        eventNeedsEndsAt: event.needs_ends_at ?? null,
      });
      const live = await buildLivePayload(event.id, event.code);
      publish(event.code, "update", live);
      publish(event.code, "pledge", {
        pledgeId: placed.pledgeId,
        needId: parsed.data.needId,
        amount: placed.amount,
        units: placed.units,
        anonymous: placed.anonymous,
        guestName: placed.displayName,
        text: placed.text,
        createdAt: placed.createdAt,
        hitTarget: placed.hitTarget,
        fullyFunded: placed.fullyFunded,
        raised: placed.raised,
      });
      return { ok: true, ...placed, undoSeconds: PLEDGE_UNDO_SECONDS, live };
    } catch (e) {
      const err = e as Error & { statusCode?: number; remaining?: number };
      if (err.statusCode && err.statusCode < 500) {
        return reply.code(err.statusCode).send({ error: err.message, remaining: err.remaining });
      }
      throw e;
    }
  });

  app.delete("/api/events/:code/pledges/:pledgeId", { config: rateLimitFor("bid") }, async (req, reply) => {
    const { code: raw, pledgeId } = req.params as { code: string; pledgeId: string };
    if (!z.string().uuid().safeParse(pledgeId).success) return reply.code(404).send({ error: "Pledge not found" });
    const event = await getEventByCode(codeOf(raw));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    try {
      const undone = await undoPledge({ eventId: event.id, pledgeId, guestId: guest.id });
      const live = await buildLivePayload(event.id, event.code);
      publish(event.code, "update", live);
      publish(event.code, "pledge-undone", { pledgeId, needId: undone.needId });
      return { ok: true, live };
    } catch (e) {
      const err = e as Error & { statusCode?: number; tooLate?: boolean };
      if (err.statusCode && err.statusCode < 500) {
        return reply.code(err.statusCode).send({ error: err.message, tooLate: err.tooLate });
      }
      throw e;
    }
  });

  app.put("/api/events/:code/me/recognition", async (req, reply) => {
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req as never);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const parsed = z
      .object({
        namedPublicly: z.boolean(),
        publicName: z.string().max(80).optional(),
        showAmount: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check the public name and try again" });
    try {
      const saved = await saveGuestRecognition({
        eventId: event.id,
        guestId: guest.id,
        guestName: guest.name,
        input: { ...parsed.data, guestName: guest.name },
      });
      const live = await buildLivePayload(event.id, event.code);
      publish(event.code, "update", live);
      return {
        ok: true,
        recognition: {
          namedPublicly: saved.namedPublicly,
          publicName: saved.moderatedName.trim() || saved.publicName,
          showAmount: saved.showAmount,
          hiddenByHost: saved.hiddenByHost,
        },
        live,
      };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      throw e;
    }
  });

  app.get("/api/host/events/:code/needs", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const rows = await listNeedRows(ctx.event.id, { includeHidden: true });
    const bundle = await hostPledgeBundle(ctx.event.id);
    const donationRoutes = await listDonationRoutes(ctx.event.id);
    const routeOf = new Map(donationRoutes.map((r) => [r.guestId, r]));
    const needs = rows.map((row) => ({
      ...toPublicNeed(row, ctx.event.code, ctx.event.needs_ends_at ?? null),
      hidden: row.hidden,
      ownEndsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      pledges: (bundle.pledges.get(row.id) ?? []).map((p) => ({
        ...p,
        paymentChannel: routeOf.get(p.guestId)?.channel ?? null,
        paymentChannelLabel: routeOf.get(p.guestId)?.label ?? null,
      })),
      audit: bundle.audits.get(row.id) ?? [],
    }));
    const donations = needs.reduce((s, n) => s + n.raised, 0);
    return {
      needsEndsAt: ctx.event.needs_ends_at ? new Date(ctx.event.needs_ends_at).toISOString() : null,
      spotlightNeedId: ctx.event.spotlight_need_id ?? null,
      currency: parseCurrency(ctx.event.currency),
      donations,
      needs,
      donationRoutes,
      recognition: {
        enabled: ctx.event.donor_recognition !== false,
        topDonorsScreen: ctx.event.top_donors_screen !== false,
        topDonorsLimit: Number(ctx.event.top_donors_limit ?? 10) || 10,
        spotlightTopDonors: Boolean(ctx.event.spotlight_top_donors),
        donors: await hostDonorBoard(ctx.event.id),
      },
    };
  });

  app.post("/api/host/events/:code/donation-route", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = z
      .object({
        guestId: z.string().uuid(),
        channel: z.enum(["mercy", "wolfgang"]).nullable(),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Choose a channel and give a reason" });
    try {
      const route = await setDonationRouteOverride({
        eventId: ctx.event.id,
        guestId: parsed.data.guestId,
        channel: parsed.data.channel,
        reason: parsed.data.reason,
        actor: ctx.host.email,
      });
      return { ok: true, route };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      throw e;
    }
  });

  app.post("/api/host/events/:code/needs/examples", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const created = await insertExampleNeeds(ctx.event.id);
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, created, live };
  });

  app.post("/api/host/events/:code/needs/reorder", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "ids must be need ids" });
    const known = await pool.query("SELECT id FROM needs WHERE event_id = $1", [ctx.event.id]);
    const have = new Set(known.rows.map((r) => r.id as string));
    if (parsed.data.ids.length !== have.size || parsed.data.ids.some((id) => !have.has(id))) {
      return reply.code(400).send({ error: "Reorder must list every need of this event once" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < parsed.data.ids.length; i++) {
        await client.query("UPDATE needs SET sort_order = $1 WHERE id = $2 AND event_id = $3", [
          i,
          parsed.data.ids[i],
          ctx.event.id,
        ]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.post("/api/host/events/:code/needs", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = needBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;
    if (body.minPledge > body.targetAmount) {
      return reply.code(400).send({ error: "Minimum pledge cannot be higher than the target" });
    }
    const presetSource =
      body.suggestedAmounts ?? [1000, 5000, 10000, 25000].filter((n) => n + 0.001 >= body.minPledge);
    const amounts = parseSuggestedAmounts(presetSource, body.minPledge);
    if (!amounts.ok) return reply.code(400).send({ error: amounts.error });
    const unit = cleanUnit(body.unitLabel, body.unitAmount);
    if ("error" in unit) return reply.code(400).send({ error: unit.error });
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (body.endsAt && endsAt && !Number.isFinite(endsAt.getTime())) {
      return reply.code(400).send({ error: "Invalid end time" });
    }
    const sort = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM needs WHERE event_id = $1",
      [ctx.event.id],
    );
    const ins = await pool.query(
      `INSERT INTO needs
        (event_id, title, beneficiary, description, target_amount, min_pledge, suggested_amounts,
         unit_label, unit_amount, cap_at_target, ends_at, hidden, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        ctx.event.id,
        body.title.trim(),
        body.beneficiary.trim(),
        body.description,
        body.targetAmount,
        body.minPledge,
        JSON.stringify(amounts.amounts),
        unit.unitLabel,
        unit.unitAmount,
        body.capAtTarget,
        endsAt,
        body.hidden,
        sort.rows[0].n,
      ],
    );
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, id: ins.rows[0].id as string, live };
  });

  const patchBody = needBody.partial().extend({
    closed: z.boolean().optional(),
  });

  app.patch("/api/host/events/:code/needs/:needId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const needId = (req.params as { needId: string }).needId;
    if (!z.string().uuid().safeParse(needId).success) return reply.code(404).send({ error: "Need not found" });
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const current = await pool.query("SELECT * FROM needs WHERE id = $1 AND event_id = $2", [needId, ctx.event.id]);
    const row = current.rows[0];
    if (!row) return reply.code(404).send({ error: "Need not found" });
    const b = parsed.data;
    const target = b.targetAmount ?? Number(row.target_amount);
    const minPledge = b.minPledge ?? Number(row.min_pledge);
    if (!(target > 0) || !(minPledge > 0)) return reply.code(400).send({ error: "Amounts must be positive" });
    if (minPledge > target) return reply.code(400).send({ error: "Minimum pledge cannot be higher than the target" });
    const suggested = b.suggestedAmounts ?? row.suggested_amounts;
    const amounts = parseSuggestedAmounts(suggested, minPledge);
    if (!amounts.ok) return reply.code(400).send({ error: amounts.error });
    const unit = cleanUnit(
      b.unitLabel === undefined ? row.unit_label : b.unitLabel,
      b.unitAmount === undefined ? (row.unit_amount == null ? null : Number(row.unit_amount)) : b.unitAmount,
    );
    if ("error" in unit) return reply.code(400).send({ error: unit.error });
    let endsAt: Date | null = row.ends_at;
    if (b.endsAt !== undefined) endsAt = b.endsAt ? new Date(b.endsAt) : null;
    let closedAt: Date | null = row.closed_at;
    if (b.closed === true) closedAt = row.closed_at ?? new Date();
    if (b.closed === false) closedAt = null;
    await pool.query(
      `UPDATE needs SET
         title = $2, beneficiary = $3, description = $4, target_amount = $5, min_pledge = $6,
         suggested_amounts = $7::jsonb, unit_label = $8, unit_amount = $9, cap_at_target = $10,
         ends_at = $11, hidden = $12, closed_at = $13
       WHERE id = $1`,
      [
        needId,
        (b.title ?? row.title).trim(),
        (b.beneficiary ?? row.beneficiary).trim(),
        b.description ?? row.description,
        target,
        minPledge,
        JSON.stringify(amounts.amounts),
        unit.unitLabel,
        unit.unitAmount,
        b.capAtTarget ?? row.cap_at_target,
        endsAt,
        b.hidden ?? row.hidden,
        closedAt,
      ],
    );
    if (b.hidden === true && ctx.event.spotlight_need_id === needId) {
      await pool.query("UPDATE events SET spotlight_need_id = NULL WHERE id = $1", [ctx.event.id]);
    }
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.delete("/api/host/events/:code/needs/:needId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const needId = (req.params as { needId: string }).needId;
    if (!z.string().uuid().safeParse(needId).success) return reply.code(404).send({ error: "Need not found" });
    const used = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM pledges WHERE need_id = $1) AS pledges,
         (SELECT COUNT(*)::int FROM invoice_donations WHERE need_id = $1) AS invoices`,
      [needId],
    );
    if ((used.rows[0].pledges as number) > 0 || (used.rows[0].invoices as number) > 0) {
      return reply.code(409).send({ error: "This need has pledges — hide or close it instead of deleting it" });
    }
    const del = await pool.query("DELETE FROM needs WHERE id = $1 AND event_id = $2 RETURNING id", [
      needId,
      ctx.event.id,
    ]);
    if (!del.rows[0]) return reply.code(404).send({ error: "Need not found" });
    await pool.query("UPDATE events SET spotlight_need_id = NULL WHERE id = $1 AND spotlight_need_id = $2", [
      ctx.event.id,
      needId,
    ]);
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.post("/api/host/events/:code/needs/:needId/photo", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const needId = (req.params as { needId: string }).needId;
    if (!z.string().uuid().safeParse(needId).success) return reply.code(404).send({ error: "Need not found" });
    const known = await pool.query("SELECT id FROM needs WHERE id = $1 AND event_id = $2", [needId, ctx.event.id]);
    if (!known.rows[0]) return reply.code(404).send({ error: "Need not found" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Photo required" });
    const buffer = await file.toBuffer();
    const uploaded = { filename: file.filename, mimetype: file.mimetype, buffer };
    if (!isImage(uploaded)) return reply.code(400).send({ error: "Photo must be jpg, png, webp, or gif" });
    const path = await saveUpload("photos", uploaded.filename, uploaded.buffer, needId);
    await pool.query("UPDATE needs SET photo_url = $1 WHERE id = $2", [path, needId]);
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.post("/api/host/events/:code/pledges/:pledgeId/void", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const pledgeId = (req.params as { pledgeId: string }).pledgeId;
    if (!z.string().uuid().safeParse(pledgeId).success) return reply.code(404).send({ error: "Pledge not found" });
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "A reason is required" });
    try {
      await voidPledge({ eventId: ctx.event.id, pledgeId, hostEmail: ctx.host.email, reason: parsed.data.reason });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      throw e;
    }
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.post("/api/host/events/:code/pledges/:pledgeId/correct", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const pledgeId = (req.params as { pledgeId: string }).pledgeId;
    if (!z.string().uuid().safeParse(pledgeId).success) return reply.code(404).send({ error: "Pledge not found" });
    const parsed = z
      .object({
        reason: z.string().trim().min(1).max(500),
        amount: z.number().positive().nullable().optional(),
        units: z.number().int().positive().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "A new amount and a reason are required" });
    try {
      const corrected = await correctPledge({
        eventId: ctx.event.id,
        pledgeId,
        hostEmail: ctx.host.email,
        reason: parsed.data.reason,
        amount: parsed.data.amount,
        units: parsed.data.units,
      });
      const live = await buildLivePayload(ctx.event.id, ctx.event.code);
      publish(ctx.event.code, "update", live);
      return { ok: true, amount: corrected.amount, live };
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      throw e;
    }
  });

  const fundBody = z.object({
    needsEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
    spotlightNeedId: z.string().uuid().nullable().optional(),
    donorRecognition: z.boolean().optional(),
    topDonorsScreen: z.boolean().optional(),
    topDonorsLimit: z.number().int().min(1).max(50).optional(),
    spotlightTopDonors: z.boolean().optional(),
  });

  app.patch("/api/host/events/:code/fund", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = fundBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.needsEndsAt !== undefined) {
      const ends = parsed.data.needsEndsAt ? new Date(parsed.data.needsEndsAt) : null;
      await pool.query("UPDATE events SET needs_ends_at = $1 WHERE id = $2", [ends, ctx.event.id]);
    }
    if (parsed.data.donorRecognition !== undefined) {
      await pool.query("UPDATE events SET donor_recognition = $1 WHERE id = $2", [parsed.data.donorRecognition, ctx.event.id]);
    }
    if (parsed.data.topDonorsScreen !== undefined) {
      await pool.query("UPDATE events SET top_donors_screen = $1 WHERE id = $2", [parsed.data.topDonorsScreen, ctx.event.id]);
    }
    if (parsed.data.topDonorsLimit !== undefined) {
      await pool.query("UPDATE events SET top_donors_limit = $1 WHERE id = $2", [parsed.data.topDonorsLimit, ctx.event.id]);
    }
    if (parsed.data.spotlightTopDonors === true) {
      await pool.query("UPDATE events SET spotlight_top_donors = true, spotlight_need_id = NULL WHERE id = $1", [ctx.event.id]);
    } else if (parsed.data.spotlightTopDonors === false) {
      await pool.query("UPDATE events SET spotlight_top_donors = false WHERE id = $1", [ctx.event.id]);
    }
    if (parsed.data.spotlightNeedId !== undefined && parsed.data.spotlightTopDonors !== true) {
      const id = parsed.data.spotlightNeedId;
      if (id) {
        const need = await pool.query(
          "SELECT id, hidden FROM needs WHERE id = $1 AND event_id = $2",
          [id, ctx.event.id],
        );
        if (!need.rows[0]) return reply.code(404).send({ error: "Need not found" });
        if (need.rows[0].hidden) return reply.code(409).send({ error: "Unhide the need before putting it on the big screen" });
      }
      await pool.query(
        "UPDATE events SET spotlight_need_id = $1, spotlight_top_donors = CASE WHEN $1::uuid IS NULL THEN spotlight_top_donors ELSE false END WHERE id = $2",
        [id, ctx.event.id],
      );
    }
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });

  app.post("/api/host/events/:code/recognition", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = z
      .object({
        guestId: z.string().uuid(),
        reason: z.string().trim().min(1).max(500),
        name: z.string().max(80).optional(),
        hidden: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success || (parsed.data.name === undefined && parsed.data.hidden === undefined)) {
      return reply.code(400).send({ error: "A reason, and a name or a hide choice, are required" });
    }
    try {
      await moderateDonor({
        eventId: ctx.event.id,
        guestId: parsed.data.guestId,
        hostEmail: ctx.host.email,
        reason: parsed.data.reason,
        name: parsed.data.name,
        hidden: parsed.data.hidden,
      });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      throw e;
    }
    const live = await buildLivePayload(ctx.event.id, ctx.event.code);
    publish(ctx.event.code, "update", live);
    return { ok: true, live };
  });
}
