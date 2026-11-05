import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "./db.js";
import { publish } from "./sse.js";
import { contentTypeFor, readDataFile, saveUpload } from "./storage.js";
import { guestFromRequest } from "./guestAuth.js";
import { rateLimitFor } from "./security.js";
import type { HostUser } from "./hostAuth.js";
import {
  createGewerk,
  createProject,
  deleteGewerk,
  deleteProject,
  hostProjectBundle,
  myProjectPledges,
  placeGewerkPledge,
  seedSchoolProject,
  updateGewerk,
  updateProject,
} from "./projects.js";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isImage(file: { filename: string; mimetype: string }) {
  const mime = (file.mimetype || "").toLowerCase();
  if (IMAGE_MIME.has(mime)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.filename || "");
}

function statusOf(e: unknown) {
  return (e as Error & { statusCode?: number }).statusCode;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: {
    codeOf: (raw: string) => string;
    getEventByCode: (code: string) => Promise<{ id: string; code: string } | undefined>;
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

  async function live(event: { id: string; code: string }) {
    const payload = await buildLivePayload(event.id, event.code);
    publish(event.code, "update", payload);
    return payload;
  }

  app.get("/api/events/:code/projects/:projectId/photo", async (req, reply) => servePhoto(req, reply, "projects"));
  app.get("/api/events/:code/gewerke/:gewerkId/photo", async (req, reply) => servePhoto(req, reply, "gewerke"));

  async function servePhoto(
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
    kind: "projects" | "gewerke",
  ) {
    const params = req.params as { code: string; projectId?: string; gewerkId?: string };
    const id = kind === "projects" ? params.projectId : params.gewerkId;
    if (!id || !z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: "No photo" });
    const event = await getEventByCode(codeOf(params.code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const sql =
      kind === "projects"
        ? "SELECT photo_url FROM projects WHERE id = $1 AND event_id = $2"
        : `SELECT g.photo_url FROM gewerke g JOIN projects p ON p.id = g.project_id WHERE g.id = $1 AND p.event_id = $2`;
    const { rows } = await pool.query(sql, [id, event.id]);
    const stored = rows[0]?.photo_url as string | null | undefined;
    if (!stored) return reply.code(404).send({ error: "No photo" });
    if (/^https?:\/\//i.test(stored)) return reply.redirect(stored);
    const buf = await readDataFile(stored);
    return reply.header("Cache-Control", "public, max-age=86400").type(contentTypeFor(stored)).send(buf);
  }

  app.get("/api/events/:code/me/project-pledges", async (req, reply) => {
    const event = await getEventByCode(codeOf((req.params as { code: string }).code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    return { gifts: await myProjectPledges(event.id, guest.id) };
  });

  app.post("/api/events/:code/gewerke/:gewerkId/pledges", { config: rateLimitFor("bid") }, async (req, reply) => {
    const { code, gewerkId } = req.params as { code: string; gewerkId: string };
    if (!z.string().uuid().safeParse(gewerkId).success) return reply.code(404).send({ error: "Gewerk not found" });
    const event = await getEventByCode(codeOf(code));
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const guest = await guestFromRequest(req);
    if (!guest || guest.event_id !== event.id) return reply.code(401).send({ error: "Join the event first" });
    const parsed = z
      .object({
        mode: z.enum(["full", "partial"]),
        amount: z.number().positive().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check the amount and try again" });
    try {
      const pledge = await placeGewerkPledge({
        eventId: event.id,
        gewerkId,
        guestId: guest.id,
        mode: parsed.data.mode,
        amount: parsed.data.amount,
      });
      return { ok: true, pledge, live: await live(event) };
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
  });

  app.get("/api/host/events/:code/projects", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    return hostProjectBundle(ctx.event.id);
  });

  app.post("/api/host/events/:code/projects/example", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const seeded = await seedSchoolProject(ctx.event.id);
    return { ok: true, ...seeded, live: await live(ctx.event) };
  });

  const projectBody = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    placeholder: z.boolean().optional(),
  });

  app.post("/api/host/events/:code/projects", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await createProject(ctx.event.id, parsed.data);
    return { ok: true, live: await live(ctx.event) };
  });

  app.patch("/api/host/events/:code/projects/:projectId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const projectId = (req.params as { projectId: string }).projectId;
    if (!z.string().uuid().safeParse(projectId).success) return reply.code(404).send({ error: "Project not found" });
    const parsed = projectBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await updateProject(ctx.event.id, projectId, parsed.data);
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
    return { ok: true, live: await live(ctx.event) };
  });

  app.delete("/api/host/events/:code/projects/:projectId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const projectId = (req.params as { projectId: string }).projectId;
    try {
      await deleteProject(ctx.event.id, projectId);
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
    return { ok: true, live: await live(ctx.event) };
  });

  app.post("/api/host/events/:code/projects/:projectId/photo", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const projectId = (req.params as { projectId: string }).projectId;
    if (!z.string().uuid().safeParse(projectId).success) return reply.code(404).send({ error: "Project not found" });
    const known = await pool.query("SELECT id FROM projects WHERE id = $1 AND event_id = $2", [projectId, ctx.event.id]);
    if (!known.rows[0]) return reply.code(404).send({ error: "Project not found" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Photo required" });
    const buffer = await file.toBuffer();
    const uploaded = { filename: file.filename, mimetype: file.mimetype, buffer };
    if (!isImage(uploaded)) return reply.code(400).send({ error: "Photo must be jpg, png, webp, or gif" });
    const path = await saveUpload("photos", uploaded.filename, uploaded.buffer, projectId);
    await pool.query("UPDATE projects SET photo_url = $1 WHERE id = $2", [path, projectId]);
    return { ok: true, live: await live(ctx.event) };
  });

  const gewerkBody = projectBody.extend({
    targetAmount: z.number().positive(),
  });

  app.post("/api/host/events/:code/projects/:projectId/gewerke", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const projectId = (req.params as { projectId: string }).projectId;
    const parsed = gewerkBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await createGewerk(ctx.event.id, projectId, parsed.data);
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
    return { ok: true, live: await live(ctx.event) };
  });

  app.patch("/api/host/events/:code/gewerke/:gewerkId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const gewerkId = (req.params as { gewerkId: string }).gewerkId;
    if (!z.string().uuid().safeParse(gewerkId).success) return reply.code(404).send({ error: "Gewerk not found" });
    const parsed = gewerkBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await updateGewerk(ctx.event.id, gewerkId, parsed.data);
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
    return { ok: true, live: await live(ctx.event) };
  });

  app.delete("/api/host/events/:code/gewerke/:gewerkId", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const gewerkId = (req.params as { gewerkId: string }).gewerkId;
    try {
      await deleteGewerk(ctx.event.id, gewerkId);
    } catch (e) {
      const status = statusOf(e);
      if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
      throw e;
    }
    return { ok: true, live: await live(ctx.event) };
  });

  app.post("/api/host/events/:code/gewerke/:gewerkId/photo", async (req, reply) => {
    const ctx = await hostEvent(req, reply);
    if (!ctx) return;
    const gewerkId = (req.params as { gewerkId: string }).gewerkId;
    if (!z.string().uuid().safeParse(gewerkId).success) return reply.code(404).send({ error: "Gewerk not found" });
    const known = await pool.query(
      `SELECT g.id FROM gewerke g JOIN projects p ON p.id = g.project_id WHERE g.id = $1 AND p.event_id = $2`,
      [gewerkId, ctx.event.id],
    );
    if (!known.rows[0]) return reply.code(404).send({ error: "Gewerk not found" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Photo required" });
    const buffer = await file.toBuffer();
    const uploaded = { filename: file.filename, mimetype: file.mimetype, buffer };
    if (!isImage(uploaded)) return reply.code(400).send({ error: "Photo must be jpg, png, webp, or gif" });
    const path = await saveUpload("photos", uploaded.filename, uploaded.buffer, gewerkId);
    await pool.query("UPDATE gewerke SET photo_url = $1 WHERE id = $2", [path, gewerkId]);
    return { ok: true, live: await live(ctx.event) };
  });
}
