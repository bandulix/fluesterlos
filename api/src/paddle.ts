import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { parseCurrency, money, type Currency } from "./auction.js";
import { pool } from "./db.js";
import { placePledge } from "./needs.js";
import { formatPledgeAmount, parseSuggestedAmounts } from "./pledges.js";
import { visibleName, writeGuestRecognition } from "./recognition.js";

/** Paddle pops use this when the donor has not asked to be named. */
export const GENEROUS_GUEST = "A generous guest";

export const DEFAULT_PADDLE_LEVELS = [50000, 20000, 10000, 5000, 2000];

export type PaddleStatus = "off" | "live" | "paused" | "ended";

export type PaddlePop = { id: string; name: string; amount: number; createdAt: string };

export type PaddlePublic = {
  status: Exclude<PaddleStatus, "off">;
  title: string;
  needId: string;
  goal: number;
  raised: number;
  /** Current asking amount. Null once the session has ended. */
  level: number | null;
  levels: number[];
  levelIndex: number;
  levelCount: number;
  hitGoal: boolean;
  /** Pledges since this paddle raise started. */
  pledgeCount: number;
  /** Of those, how many are at the level being called now. */
  atLevel: number;
  pops: PaddlePop[];
};

type PaddleEvent = {
  id: string;
  currency?: string;
  donor_recognition?: boolean;
  needs_ends_at?: Date | null;
  paddle_status?: string | null;
  paddle_need_id?: string | null;
  paddle_levels?: unknown;
  paddle_level_index?: number | string | null;
  paddle_goal?: string | number | null;
  paddle_title?: string | null;
  paddle_started_at?: Date | string | null;
};

/** Highest first, unique, at most 8. */
export function cleanLevels(raw: unknown): { ok: true; levels: number[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one paddle level" };
  if (raw.length > 8) return { ok: false, error: "At most 8 paddle levels" };
  const levels: number[] = [];
  for (const v of raw) {
    const n = money(Number(v));
    if (!(n > 0)) return { ok: false, error: "Paddle levels must be positive amounts" };
    if (!levels.includes(n)) levels.push(n);
  }
  levels.sort((a, b) => b - a);
  return { ok: true, levels };
}

/** "4" and "Guest 4" are a guest number. Anything else is a name called in the room. */
export function paddleWho(raw: string): { kind: "number"; guestNo: number } | { kind: "name"; name: string } | { kind: "empty" } {
  const s = raw.trim();
  if (!s) return { kind: "empty" };
  const num = s.match(/^(?:#|guest\s+)?(\d{1,6})$/i);
  if (num) return { kind: "number", guestNo: Number(num[1]) };
  return { kind: "name", name: s.slice(0, 80) };
}

export function paddleAsk(level: number, currency: Currency = "THB"): string {
  return `Who raises at ${formatPledgeAmount(level, currency)}?`;
}

export function paddlePopName(named: string | null | undefined): string {
  const n = named?.trim();
  return n ? n : GENEROUS_GUEST;
}

function asStatus(raw: string | null | undefined): PaddleStatus {
  if (raw === "live" || raw === "paused" || raw === "ended") return raw;
  return "off";
}

function asLevels(raw: unknown): number[] {
  const parsed = cleanLevels(Array.isArray(raw) ? raw : []);
  return parsed.ok ? parsed.levels : [];
}

export async function loadPaddle(eventId: string): Promise<PaddlePublic | null> {
  const { rows } = await pool.query("SELECT * FROM events WHERE id = $1", [eventId]);
  const event = rows[0] as PaddleEvent | undefined;
  if (!event) return null;
  return paddleFromRow(event);
}

async function paddleFromRow(event: PaddleEvent): Promise<PaddlePublic | null> {
  const status = asStatus(event.paddle_status);
  const needId = event.paddle_need_id ?? null;
  if (status === "off" || !needId) return null;
  const levels = asLevels(event.paddle_levels);
  const levelCount = levels.length;
  const levelIndex = Math.max(0, Math.min(Number(event.paddle_level_index ?? 0) || 0, Math.max(0, levelCount - 1)));
  const goal = money(event.paddle_goal ?? 0);
  const raisedRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS raised FROM pledges
     WHERE need_id = $1 AND undone_at IS NULL AND voided_at IS NULL`,
    [needId],
  );
  const raised = money(raisedRes.rows[0].raised);
  const started = event.paddle_started_at ? new Date(event.paddle_started_at) : null;
  const level = status === "ended" ? null : (levels[levelIndex] ?? null);
  const counts = await paddleCounts(needId, started, level);
  const pops = await paddlePops(needId, event.donor_recognition !== false, started);
  return {
    status,
    title: (event.paddle_title ?? "").trim() || "Paddle raise",
    needId,
    goal,
    raised,
    level,
    levels,
    levelIndex,
    levelCount,
    hitGoal: goal > 0 && raised + 0.001 >= goal,
    pledgeCount: counts.pledgeCount,
    atLevel: counts.atLevel,
    pops,
  };
}

async function paddleCounts(needId: string, started: Date | null, level: number | null): Promise<{ pledgeCount: number; atLevel: number }> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE amount = $3)::int AS at_level
     FROM pledges
     WHERE need_id = $1 AND undone_at IS NULL AND voided_at IS NULL
       AND ($2::timestamptz IS NULL OR created_at >= $2)`,
    [needId, started, level ?? -1],
  );
  return { pledgeCount: rows[0].n as number, atLevel: level == null ? 0 : (rows[0].at_level as number) };
}

async function paddlePops(needId: string, recognitionOn: boolean, started: Date | null): Promise<PaddlePop[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.amount, p.created_at,
            g.name AS guest_name, g.recognize_public, g.public_name, g.recognition_name, g.recognition_hidden
     FROM pledges p
     JOIN guests g ON g.id = p.guest_id
     WHERE p.need_id = $1 AND p.undone_at IS NULL AND p.voided_at IS NULL
       AND ($2::timestamptz IS NULL OR p.created_at >= $2)
     ORDER BY p.created_at DESC
     LIMIT 8`,
    [needId, started],
  );
  return rows.map((r) => {
    const shown = recognitionOn
      ? visibleName({
          guestId: "",
          guestName: r.guest_name as string,
          namedPublicly: Boolean(r.recognize_public),
          publicName: (r.public_name as string) ?? "",
          moderatedName: (r.recognition_name as string) ?? "",
          showAmount: false,
          hiddenByHost: Boolean(r.recognition_hidden),
        })
      : null;
    return {
      id: r.id as string,
      name: paddlePopName(shown),
      amount: money(r.amount),
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

async function eventRow(client: PoolClient, eventId: string): Promise<PaddleEvent> {
  const { rows } = await client.query("SELECT * FROM events WHERE id = $1 FOR UPDATE", [eventId]);
  if (!rows[0]) throw Object.assign(new Error("Event not found"), { statusCode: 404 });
  return rows[0] as PaddleEvent;
}

export async function startPaddle(opts: {
  eventId: string;
  needId?: string | null;
  title?: string;
  levels: unknown;
  goal: number;
}): Promise<void> {
  const levels = cleanLevels(opts.levels);
  if (!levels.ok) throw Object.assign(new Error(levels.error), { statusCode: 400 });
  const goal = money(opts.goal);
  if (!(goal > 0)) throw Object.assign(new Error("Set a goal above zero"), { statusCode: 400 });
  const title = (opts.title ?? "").trim().slice(0, 200);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await eventRow(client, opts.eventId);
    let needId = opts.needId ?? null;
    if (needId) {
      const need = await client.query(
        "SELECT id, title, min_pledge, hidden, closed_at FROM needs WHERE id = $1 AND event_id = $2 FOR UPDATE",
        [needId, opts.eventId],
      );
      const row = need.rows[0];
      if (!row) throw Object.assign(new Error("Need not found"), { statusCode: 404 });
      if (row.hidden || row.closed_at) throw Object.assign(new Error("That need is hidden or closed"), { statusCode: 409 });
      const min = money(row.min_pledge);
      if (levels.levels.some((n) => n + 0.001 < min)) {
        throw Object.assign(new Error("Every paddle level must be at least the need's minimum pledge"), { statusCode: 400 });
      }
      if (!title) {
        await client.query(
          `UPDATE events SET paddle_status = 'live', paddle_need_id = $2, paddle_levels = $3::jsonb,
             paddle_level_index = 0, paddle_goal = $4, paddle_title = $5, paddle_started_at = now()
           WHERE id = $1`,
          [opts.eventId, needId, JSON.stringify(levels.levels), goal, row.title as string],
        );
      } else {
        await client.query(
          `UPDATE events SET paddle_status = 'live', paddle_need_id = $2, paddle_levels = $3::jsonb,
             paddle_level_index = 0, paddle_goal = $4, paddle_title = $5, paddle_started_at = now()
           WHERE id = $1`,
          [opts.eventId, needId, JSON.stringify(levels.levels), goal, title],
        );
      }
    } else {
      if (!title) throw Object.assign(new Error("Name the appeal, or pick a need"), { statusCode: 400 });
      const minPledge = levels.levels[levels.levels.length - 1];
      const target = Math.max(goal, minPledge);
      const suggested = parseSuggestedAmounts(levels.levels, minPledge);
      if (!suggested.ok) throw Object.assign(new Error(suggested.error), { statusCode: 400 });
      const sort = await client.query(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM needs WHERE event_id = $1",
        [opts.eventId],
      );
      const ins = await client.query(
        `INSERT INTO needs
          (event_id, title, beneficiary, description, target_amount, min_pledge, suggested_amounts, cap_at_target, sort_order)
         VALUES ($1,$2,'','Paddle raise', $3,$4,$5::jsonb,false,$6)
         RETURNING id`,
        [opts.eventId, title, target, minPledge, JSON.stringify(suggested.amounts), sort.rows[0].n],
      );
      needId = ins.rows[0].id as string;
      await client.query(
        `UPDATE events SET paddle_status = 'live', paddle_need_id = $2, paddle_levels = $3::jsonb,
           paddle_level_index = 0, paddle_goal = $4, paddle_title = $5, paddle_started_at = now()
         WHERE id = $1`,
        [opts.eventId, needId, JSON.stringify(levels.levels), goal, title],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function stepPaddle(eventId: string, action: "next" | "pause" | "resume" | "end"): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const event = await eventRow(client, eventId);
    const status = asStatus(event.paddle_status);
    if (status !== "live" && status !== "paused") {
      throw Object.assign(new Error("Start the paddle raise first"), { statusCode: 409 });
    }
    if (action === "pause") {
      if (status !== "live") throw Object.assign(new Error("The paddle raise is not live"), { statusCode: 409 });
      await client.query("UPDATE events SET paddle_status = 'paused' WHERE id = $1", [eventId]);
    } else if (action === "resume") {
      if (status !== "paused") throw Object.assign(new Error("The paddle raise is not paused"), { statusCode: 409 });
      await client.query("UPDATE events SET paddle_status = 'live' WHERE id = $1", [eventId]);
    } else if (action === "end") {
      await client.query("UPDATE events SET paddle_status = 'ended' WHERE id = $1", [eventId]);
    } else {
      const levels = asLevels(event.paddle_levels);
      const index = Number(event.paddle_level_index ?? 0) || 0;
      if (index + 1 >= levels.length) throw Object.assign(new Error("That was the last level"), { statusCode: 409 });
      await client.query("UPDATE events SET paddle_level_index = $2, paddle_status = 'live' WHERE id = $1", [eventId, index + 1]);
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

async function assertLive(eventId: string): Promise<{ needId: string; level: number; currency: Currency; needsEndsAt: Date | null }> {
  const paddle = await loadPaddle(eventId);
  if (!paddle || paddle.status === "ended" || paddle.level == null) {
    throw Object.assign(new Error("Paddle raise is not running"), { statusCode: 409 });
  }
  if (paddle.status === "paused") throw Object.assign(new Error("Paddle raise is paused"), { statusCode: 409 });
  const { rows } = await pool.query("SELECT currency, needs_ends_at FROM events WHERE id = $1", [eventId]);
  return {
    needId: paddle.needId,
    level: paddle.level,
    currency: parseCurrency(rows[0]?.currency),
    needsEndsAt: rows[0]?.needs_ends_at ?? null,
  };
}

/** One tap at the level the host is calling. Recognition stays as the guest already set it. */
export async function guestPaddlePledge(opts: { eventId: string; guestId: string; guestName: string }) {
  const live = await assertLive(opts.eventId);
  const placed = await placePledge({
    eventId: opts.eventId,
    needId: live.needId,
    guestId: opts.guestId,
    guestName: opts.guestName,
    amount: live.level,
    currency: live.currency,
    eventNeedsEndsAt: live.needsEndsAt,
  });
  return { ...placed, needId: live.needId };
}

async function guestForPaddle(eventId: string, who: string, actor: string): Promise<{ id: string; name: string }> {
  const parsed = paddleWho(who);
  if (parsed.kind === "empty") throw Object.assign(new Error("Enter a name or a guest number"), { statusCode: 400 });
  if (parsed.kind === "number") {
    const { rows } = await pool.query(
      "SELECT id, name FROM guests WHERE event_id = $1 AND guest_no = $2",
      [eventId, parsed.guestNo],
    );
    if (!rows[0]) throw Object.assign(new Error("No guest with that number"), { statusCode: 404 });
    return { id: rows[0].id as string, name: rows[0].name as string };
  }
  const { rows } = await pool.query(
    `SELECT id, name FROM guests
     WHERE event_id = $1 AND (
       lower(btrim(name)) = lower($2)
       OR lower(btrim(public_name)) = lower($2)
       OR lower(btrim(recognition_name)) = lower($2)
     )`,
    [eventId, parsed.name],
  );
  if (rows.length > 1) throw Object.assign(new Error("More than one guest has that name — use the guest number"), { statusCode: 409 });
  if (rows[0]) return { id: rows[0].id as string, name: rows[0].name as string };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO guests (event_id, name, token, claimed_at) VALUES ($1,$2,$3, now()) RETURNING id, name`,
      [eventId, parsed.name, nanoid(24)],
    );
    const guest = { id: ins.rows[0].id as string, name: ins.rows[0].name as string };
    await writeGuestRecognition(client, {
      eventId,
      guestId: guest.id,
      guestName: guest.name,
      actor,
      input: { namedPublicly: true, publicName: parsed.name, showAmount: true, guestName: guest.name },
    });
    await client.query("COMMIT");
    return guest;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

/** A paddle seen in the room. A new name is shown; an existing guest keeps their opt-in. */
export async function hostPaddlePledge(opts: { eventId: string; who: string; actor: string }) {
  const live = await assertLive(opts.eventId);
  const guest = await guestForPaddle(opts.eventId, opts.who, opts.actor);
  const placed = await placePledge({
    eventId: opts.eventId,
    needId: live.needId,
    guestId: guest.id,
    guestName: guest.name,
    amount: live.level,
    currency: live.currency,
    eventNeedsEndsAt: live.needsEndsAt,
  });
  return { ...placed, guestId: guest.id, needId: live.needId };
}
