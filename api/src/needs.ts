import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { money, parseCurrency, type Currency } from "./auction.js";
import {
  effectiveNeedEnd,
  fundingProgress,
  needAcceptsPledges,
  pledgeCanUndo,
  pledgeFitsCap,
  pledgeTicker,
  PLEDGE_UNDO_SECONDS,
  resolvePledge,
} from "./pledges.js";

const ACTIVE = "p.undone_at IS NULL AND p.voided_at IS NULL";

export type NeedRow = {
  id: string;
  event_id: string;
  title: string;
  beneficiary: string;
  description: string;
  photo_url: string | null;
  target_amount: string | number;
  min_pledge: string | number;
  suggested_amounts: unknown;
  unit_label: string | null;
  unit_amount: string | number | null;
  cap_at_target: boolean;
  ends_at: Date | null;
  hidden: boolean;
  closed_at: Date | null;
  sort_order: number;
  example: boolean;
  created_at: Date;
  raised: string | number;
  donor_count: number;
  pledge_count: number;
};

function asAmounts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => money(n as number)).filter((n) => n > 0);
}

export function needPhotoUrl(code: string, needId: string, stored: string | null): string | null {
  if (!stored) return null;
  if (/^https?:\/\//i.test(stored)) return stored;
  return `/api/events/${code}/needs/${needId}/photo?v=${encodeURIComponent(stored.split("/").pop() ?? "")}`;
}

export type PublicNeed = {
  id: string;
  title: string;
  beneficiary: string;
  description: string;
  photoUrl: string | null;
  targetAmount: number;
  minPledge: number;
  suggestedAmounts: number[];
  unitLabel: string | null;
  unitAmount: number | null;
  capAtTarget: boolean;
  endsAt: string | null;
  open: boolean;
  sortOrder: number;
  example: boolean;
  raised: number;
  donorCount: number;
  pledgeCount: number;
  percent: number;
  barPercent: number;
  fullyFunded: boolean;
  overFunded: boolean;
  label: string;
};

export function toPublicNeed(
  row: NeedRow,
  code: string,
  eventNeedsEndsAt: Date | null,
  now = new Date(),
): PublicNeed {
  const ends = effectiveNeedEnd(row.ends_at, eventNeedsEndsAt);
  const gate = needAcceptsPledges({
    hidden: false,
    closedAt: row.closed_at,
    endsAt: ends,
    now,
  });
  const raised = money(row.raised);
  const target = money(row.target_amount);
  const progress = fundingProgress(raised, target);
  return {
    id: row.id,
    title: row.title,
    beneficiary: row.beneficiary,
    description: row.description,
    photoUrl: needPhotoUrl(code, row.id, row.photo_url),
    targetAmount: target,
    minPledge: money(row.min_pledge),
    suggestedAmounts: asAmounts(row.suggested_amounts),
    unitLabel: row.unit_label,
    unitAmount: row.unit_amount == null ? null : money(row.unit_amount),
    capAtTarget: row.cap_at_target,
    endsAt: ends ? ends.toISOString() : null,
    open: gate.ok,
    sortOrder: row.sort_order,
    example: row.example,
    raised,
    donorCount: row.donor_count,
    pledgeCount: row.pledge_count,
    percent: progress.percent,
    barPercent: progress.barPercent,
    fullyFunded: progress.fullyFunded,
    overFunded: progress.overFunded,
    label: progress.label,
  };
}

const NEED_SELECT = `
  SELECT n.*,
    COALESCE((SELECT SUM(p.amount) FROM pledges p WHERE p.need_id = n.id AND ${ACTIVE}), 0) AS raised,
    (SELECT COUNT(DISTINCT p.guest_id)::int FROM pledges p WHERE p.need_id = n.id AND ${ACTIVE}) AS donor_count,
    (SELECT COUNT(*)::int FROM pledges p WHERE p.need_id = n.id AND ${ACTIVE}) AS pledge_count
  FROM needs n`;

export async function listNeedRows(eventId: string, opts: { includeHidden: boolean }): Promise<NeedRow[]> {
  const { rows } = await pool.query(
    `${NEED_SELECT} WHERE n.event_id = $1 ${opts.includeHidden ? "" : "AND n.hidden = false"}
     ORDER BY n.sort_order, n.created_at`,
    [eventId],
  );
  return rows as NeedRow[];
}

export type RecentPledge = {
  id: string;
  needId: string;
  needTitle: string;
  amount: number;
  units: number | null;
  unitLabel: string | null;
  anonymous: boolean;
  guestName: string;
  text: string;
  createdAt: string;
};

export async function recentPledges(eventId: string, currency: Currency, limit = 20): Promise<RecentPledge[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.amount, p.units, p.anonymous, p.created_at, p.need_id,
            n.title AS need_title, n.unit_label, n.hidden, g.name AS guest_name
     FROM pledges p
     JOIN needs n ON n.id = p.need_id
     JOIN guests g ON g.id = p.guest_id
     WHERE n.event_id = $1 AND n.hidden = false AND p.undone_at IS NULL AND p.voided_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [eventId, limit],
  );
  return rows.map((r) => {
    const anonymous = Boolean(r.anonymous);
    const units = r.units == null ? null : Number(r.units);
    const guestName = anonymous ? "A guest" : (r.guest_name as string);
    const amount = money(r.amount);
    return {
      id: r.id as string,
      needId: r.need_id as string,
      needTitle: r.need_title as string,
      amount,
      units,
      unitLabel: (r.unit_label as string | null) ?? null,
      anonymous,
      guestName,
      text: pledgeTicker({
        anonymous,
        guestName: r.guest_name as string,
        units,
        unitLabel: r.unit_label as string | null,
        amount,
        currency,
      }),
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

export async function fundTotals(eventId: string): Promise<{ totalDonations: number; donorCount: number; pledgeCount: number }> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS raised,
            COUNT(DISTINCT p.guest_id)::int AS donors,
            COUNT(*)::int AS pledges
     FROM pledges p
     JOIN needs n ON n.id = p.need_id
     WHERE n.event_id = $1 AND p.undone_at IS NULL AND p.voided_at IS NULL`,
    [eventId],
  );
  return {
    totalDonations: money(rows[0].raised),
    donorCount: rows[0].donors as number,
    pledgeCount: rows[0].pledges as number,
  };
}

export type GuestPledge = {
  id: string;
  needId: string;
  amount: number;
  units: number | null;
  anonymous: boolean;
  createdAt: string;
  canUndo: boolean;
};

export async function listGuestPledges(guestId: string, eventId: string, now = new Date()): Promise<GuestPledge[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.need_id, p.amount, p.units, p.anonymous, p.created_at
     FROM pledges p
     JOIN needs n ON n.id = p.need_id
     WHERE p.guest_id = $1 AND n.event_id = $2 AND p.undone_at IS NULL AND p.voided_at IS NULL
     ORDER BY p.created_at DESC`,
    [guestId, eventId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    needId: r.need_id as string,
    amount: money(r.amount),
    units: r.units == null ? null : Number(r.units),
    anonymous: Boolean(r.anonymous),
    createdAt: new Date(r.created_at).toISOString(),
    canUndo: pledgeCanUndo(r.created_at, now),
  }));
}

export type PledgeResult = {
  pledgeId: string;
  amount: number;
  units: number | null;
  raised: number;
  hitTarget: boolean;
  fullyFunded: boolean;
  anonymous: boolean;
  createdAt: string;
  text: string;
};

async function audit(
  client: PoolClient,
  row: {
    pledgeId: string | null;
    needId: string;
    guestId: string | null;
    action: "created" | "undone" | "corrected" | "voided";
    actor: string;
    amount: number | null;
    previousAmount: number | null;
    units: number | null;
    reason: string | null;
  },
) {
  await client.query(
    `INSERT INTO pledge_audit
      (pledge_id, need_id, guest_id, action, actor, amount, previous_amount, units, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.pledgeId,
      row.needId,
      row.guestId,
      row.action,
      row.actor,
      row.amount,
      row.previousAmount,
      row.units,
      row.reason,
    ],
  );
}

async function raisedOf(client: PoolClient, needId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS raised FROM pledges
     WHERE need_id = $1 AND undone_at IS NULL AND voided_at IS NULL`,
    [needId],
  );
  return money(rows[0].raised);
}

export async function placePledge(opts: {
  eventId: string;
  needId: string;
  guestId: string;
  guestName: string;
  amount?: number | null;
  units?: number | null;
  anonymous?: boolean;
  currency?: string;
  eventNeedsEndsAt: Date | null;
}): Promise<PledgeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const needRes = await client.query(
      `SELECT n.*, e.needs_ends_at FROM needs n JOIN events e ON e.id = n.event_id
       WHERE n.id = $1 AND n.event_id = $2 FOR UPDATE OF n`,
      [opts.needId, opts.eventId],
    );
    const need = needRes.rows[0];
    if (!need) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Need not found"), { statusCode: 404 });
    }
    const ends = effectiveNeedEnd(need.ends_at, need.needs_ends_at ?? opts.eventNeedsEndsAt);
    const gate = needAcceptsPledges({ hidden: need.hidden, closedAt: need.closed_at, endsAt: ends });
    if (!gate.ok) {
      await client.query("ROLLBACK");
      const status = gate.code === "hidden" ? 404 : 409;
      throw Object.assign(new Error(gate.error), { statusCode: status });
    }
    const resolved = resolvePledge({
      amount: opts.amount,
      units: opts.units,
      unitAmount: need.unit_amount == null ? null : money(need.unit_amount),
      minPledge: need.min_pledge,
    });
    if (!resolved.ok) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error(resolved.error), { statusCode: 400 });
    }
    const before = await raisedOf(client, need.id);
    const cap = pledgeFitsCap({
      raised: before,
      target: need.target_amount,
      cap: need.cap_at_target,
      amount: resolved.amount,
    });
    if (!cap.ok) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error(cap.error), { statusCode: 409, remaining: cap.remaining });
    }
    const anonymous = Boolean(opts.anonymous);
    const ins = await client.query(
      `INSERT INTO pledges (need_id, guest_id, amount, units, anonymous)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [need.id, opts.guestId, resolved.amount, resolved.units, anonymous],
    );
    const pledgeId = ins.rows[0].id as string;
    await audit(client, {
      pledgeId,
      needId: need.id,
      guestId: opts.guestId,
      action: "created",
      actor: `guest:${opts.guestId}`,
      amount: resolved.amount,
      previousAmount: null,
      units: resolved.units,
      reason: null,
    });
    await client.query("COMMIT");
    const raised = money(before + resolved.amount);
    const target = money(need.target_amount);
    const progress = fundingProgress(raised, target);
    const beforeProgress = fundingProgress(before, target);
    const currency = parseCurrency(opts.currency);
    return {
      pledgeId,
      amount: resolved.amount,
      units: resolved.units,
      raised,
      hitTarget: progress.fullyFunded && !beforeProgress.fullyFunded,
      fullyFunded: progress.fullyFunded,
      anonymous,
      createdAt: new Date(ins.rows[0].created_at).toISOString(),
      text: pledgeTicker({
        anonymous,
        guestName: opts.guestName,
        units: resolved.units,
        unitLabel: need.unit_label,
        amount: resolved.amount,
        currency,
      }),
    };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already finished */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function undoPledge(opts: {
  eventId: string;
  pledgeId: string;
  guestId: string;
  now?: Date;
}): Promise<{ needId: string }> {
  const now = opts.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT p.*, n.event_id, n.closed_at, n.hidden, n.ends_at, e.needs_ends_at
       FROM pledges p
       JOIN needs n ON n.id = p.need_id
       JOIN events e ON e.id = n.event_id
       WHERE p.id = $1 AND n.event_id = $2
       FOR UPDATE OF p`,
      [opts.pledgeId, opts.eventId],
    );
    const p = res.rows[0];
    if (!p || p.guest_id !== opts.guestId || p.undone_at || p.voided_at) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Pledge not found"), { statusCode: 404 });
    }
    const ends = effectiveNeedEnd(p.ends_at, p.needs_ends_at);
    const gate = needAcceptsPledges({ hidden: p.hidden, closedAt: p.closed_at, endsAt: ends, now });
    if (!gate.ok || !pledgeCanUndo(p.created_at, now)) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("This pledge can no longer be undone"), { statusCode: 409, tooLate: true });
    }
    await client.query("UPDATE pledges SET undone_at = now() WHERE id = $1", [p.id]);
    await audit(client, {
      pledgeId: p.id,
      needId: p.need_id,
      guestId: opts.guestId,
      action: "undone",
      actor: `guest:${opts.guestId}`,
      amount: money(p.amount),
      previousAmount: money(p.amount),
      units: p.units == null ? null : Number(p.units),
      reason: "undo",
    });
    await client.query("COMMIT");
    return { needId: p.need_id as string };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function voidPledge(opts: {
  eventId: string;
  pledgeId: string;
  hostEmail: string;
  reason: string;
}): Promise<{ needId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT p.*, n.event_id FROM pledges p JOIN needs n ON n.id = p.need_id
       WHERE p.id = $1 AND n.event_id = $2 FOR UPDATE OF p`,
      [opts.pledgeId, opts.eventId],
    );
    const p = res.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Pledge not found"), { statusCode: 404 });
    }
    if (p.voided_at || p.undone_at) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("This pledge is already withdrawn"), { statusCode: 409 });
    }
    await client.query(
      `UPDATE pledges SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
      [p.id, opts.hostEmail, opts.reason],
    );
    await audit(client, {
      pledgeId: p.id,
      needId: p.need_id,
      guestId: p.guest_id,
      action: "voided",
      actor: opts.hostEmail,
      amount: money(p.amount),
      previousAmount: money(p.amount),
      units: p.units == null ? null : Number(p.units),
      reason: opts.reason,
    });
    await client.query("COMMIT");
    return { needId: p.need_id as string };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function correctPledge(opts: {
  eventId: string;
  pledgeId: string;
  hostEmail: string;
  reason: string;
  amount?: number | null;
  units?: number | null;
}): Promise<{ needId: string; amount: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT p.*, n.event_id, n.target_amount, n.min_pledge, n.unit_amount, n.cap_at_target
       FROM pledges p JOIN needs n ON n.id = p.need_id
       WHERE p.id = $1 AND n.event_id = $2 FOR UPDATE OF n, p`,
      [opts.pledgeId, opts.eventId],
    );
    const p = res.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Pledge not found"), { statusCode: 404 });
    }
    if (p.voided_at || p.undone_at) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("This pledge is already withdrawn"), { statusCode: 409 });
    }
    const resolved = resolvePledge({
      amount: opts.amount,
      units: opts.units,
      unitAmount: p.unit_amount == null ? null : money(p.unit_amount),
      minPledge: p.min_pledge,
    });
    if (!resolved.ok) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error(resolved.error), { statusCode: 400 });
    }
    const others = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS raised FROM pledges
       WHERE need_id = $1 AND id <> $2 AND undone_at IS NULL AND voided_at IS NULL`,
      [p.need_id, p.id],
    );
    const cap = pledgeFitsCap({
      raised: others.rows[0].raised,
      target: p.target_amount,
      cap: p.cap_at_target,
      amount: resolved.amount,
    });
    if (!cap.ok) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error(cap.error), { statusCode: 409, remaining: cap.remaining });
    }
    const previous = money(p.amount);
    await client.query("UPDATE pledges SET amount = $2, units = $3 WHERE id = $1", [
      p.id,
      resolved.amount,
      resolved.units,
    ]);
    await audit(client, {
      pledgeId: p.id,
      needId: p.need_id,
      guestId: p.guest_id,
      action: "corrected",
      actor: opts.hostEmail,
      amount: resolved.amount,
      previousAmount: previous,
      units: resolved.units,
      reason: opts.reason,
    });
    await client.query("COMMIT");
    return { needId: p.need_id as string, amount: resolved.amount };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

export type HostPledge = {
  id: string;
  guestId: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  receiptName: string | null;
  amount: number;
  units: number | null;
  anonymous: boolean;
  createdAt: string;
  undoneAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  status: "active" | "undone" | "voided";
};

export type HostAudit = {
  id: string;
  pledgeId: string | null;
  action: string;
  actor: string;
  amount: number | null;
  previousAmount: number | null;
  units: number | null;
  reason: string | null;
  createdAt: string;
};

export async function hostPledgeBundle(eventId: string): Promise<{
  pledges: Map<string, HostPledge[]>;
  audits: Map<string, HostAudit[]>;
}> {
  const pledges = await pool.query(
    `SELECT p.*, g.name AS guest_name, g.phone AS guest_phone, g.email AS guest_email, g.receipt_name
     FROM pledges p
     JOIN needs n ON n.id = p.need_id
     JOIN guests g ON g.id = p.guest_id
     WHERE n.event_id = $1
     ORDER BY p.created_at DESC`,
    [eventId],
  );
  const audits = await pool.query(
    `SELECT a.* FROM pledge_audit a
     JOIN needs n ON n.id = a.need_id
     WHERE n.event_id = $1
     ORDER BY a.created_at DESC`,
    [eventId],
  );
  const byNeed = new Map<string, HostPledge[]>();
  for (const r of pledges.rows) {
    const status: HostPledge["status"] = r.undone_at ? "undone" : r.voided_at ? "voided" : "active";
    const list = byNeed.get(r.need_id) ?? [];
    list.push({
      id: r.id,
      guestId: r.guest_id,
      guestName: r.guest_name,
      guestPhone: r.guest_phone,
      guestEmail: r.guest_email,
      receiptName: r.receipt_name,
      amount: money(r.amount),
      units: r.units == null ? null : Number(r.units),
      anonymous: Boolean(r.anonymous),
      createdAt: new Date(r.created_at).toISOString(),
      undoneAt: r.undone_at ? new Date(r.undone_at).toISOString() : null,
      voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
      voidedBy: r.voided_by,
      voidReason: r.void_reason,
      status,
    });
    byNeed.set(r.need_id, list);
  }
  const auditByNeed = new Map<string, HostAudit[]>();
  for (const r of audits.rows) {
    const list = auditByNeed.get(r.need_id) ?? [];
    list.push({
      id: r.id,
      pledgeId: r.pledge_id,
      action: r.action,
      actor: r.actor,
      amount: r.amount == null ? null : money(r.amount),
      previousAmount: r.previous_amount == null ? null : money(r.previous_amount),
      units: r.units == null ? null : Number(r.units),
      reason: r.reason,
      createdAt: new Date(r.created_at).toISOString(),
    });
    auditByNeed.set(r.need_id, list);
  }
  return { pledges: byNeed, audits: auditByNeed };
}

export { PLEDGE_UNDO_SECONDS };
