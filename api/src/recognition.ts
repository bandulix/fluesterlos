import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { money } from "./auction.js";

/** How many public donors the big screen and the guest list show unless the host changes it. */
export const DEFAULT_TOP_DONORS = 10;

export const ANONYMOUS_LABEL = "A guest";

export type Gift = {
  guestId: string;
  needId: string;
  amount: number | string;
  active: boolean;
};

export type DonorProfile = {
  guestId: string;
  guestName: string;
  namedPublicly: boolean;
  publicName: string;
  moderatedName: string;
  showAmount: boolean;
  hiddenByHost: boolean;
};

export type ListedDonor = {
  guestId: string;
  name: string;
  /** Null when the donor asked to show the name only. */
  amount: number | null;
  showAmount: boolean;
  total: number;
};

export type RankedDonor = ListedDonor & {
  rank: number;
  tier: "gold" | "silver" | "bronze" | "list";
};

export type PublicSupporter = { name: string; amount: number | null };
export type PublicTopDonor = { rank: number; tier: RankedDonor["tier"]; name: string; amount: number | null };

export function cleanPublicName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > 80) return { ok: false, error: "Public name is too long" };
  if (/[\u0000-\u001f]/.test(name)) return { ok: false, error: "Public name has invalid characters" };
  return { ok: true, name };
}

/** The name the room may print. Null means this gift is anonymous. */
export function visibleName(profile: DonorProfile, enabled = true): string | null {
  if (!enabled || !profile.namedPublicly || profile.hiddenByHost) return null;
  const name = profile.moderatedName.trim() || profile.publicName.trim();
  return name || null;
}

export function donorTier(rank: number): RankedDonor["tier"] {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "list";
}

export function anonymousGiftLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "+ 1 anonymous gift";
  return `+ ${count} anonymous gifts`;
}

function sumsFor(
  gifts: Gift[],
  profiles: DonorProfile[],
  enabled: boolean,
  needId?: string,
): { named: Map<string, { name: string; total: number; showAmount: boolean }>; anonymousGifts: number } {
  const byId = new Map(profiles.map((p) => [p.guestId, p]));
  const named = new Map<string, { name: string; total: number; showAmount: boolean }>();
  let anonymousGifts = 0;
  for (const gift of gifts) {
    if (!gift.active) continue;
    if (needId != null && gift.needId !== needId) continue;
    const profile = byId.get(gift.guestId);
    const name = profile ? visibleName(profile, enabled) : null;
    if (!name || !profile) {
      anonymousGifts += 1;
      continue;
    }
    const cur = named.get(gift.guestId) ?? { name, total: 0, showAmount: profile.showAmount };
    cur.total = money(cur.total + money(gift.amount));
    cur.name = name;
    cur.showAmount = profile.showAmount;
    named.set(gift.guestId, cur);
  }
  return { named, anonymousGifts };
}

export function supportersForNeed(
  needId: string,
  gifts: Gift[],
  profiles: DonorProfile[],
  enabled = true,
): { donors: ListedDonor[]; anonymousGifts: number } {
  const { named, anonymousGifts } = sumsFor(gifts, profiles, enabled, needId);
  const donors = [...named.entries()]
    .map(([guestId, row]) => ({
      guestId,
      name: row.name,
      showAmount: row.showAmount,
      total: row.total,
      amount: row.showAmount ? row.total : null,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { donors, anonymousGifts };
}

/** Public donors across every need. Auction bids are not in `gifts`. Voided gifts are inactive. */
export function rankDonors(
  gifts: Gift[],
  profiles: DonorProfile[],
  limit = DEFAULT_TOP_DONORS,
  enabled = true,
): RankedDonor[] {
  if (!enabled) return [];
  const cap = Math.min(50, Math.max(1, Math.floor(limit) || DEFAULT_TOP_DONORS));
  const { named } = sumsFor(gifts, profiles, true);
  return [...named.entries()]
    .map(([guestId, row]) => ({ guestId, ...row }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, cap)
    .map((row, i) => {
      const rank = i + 1;
      return {
        guestId: row.guestId,
        name: row.name,
        rank,
        tier: donorTier(rank),
        showAmount: row.showAmount,
        total: row.total,
        amount: row.showAmount ? row.total : null,
      };
    });
}

export function toPublicSupporter(d: ListedDonor): PublicSupporter {
  return { name: d.name, amount: d.amount };
}

export function toPublicTop(d: RankedDonor): PublicTopDonor {
  return { rank: d.rank, tier: d.tier, name: d.name, amount: d.amount };
}

export type RecognitionInput = {
  namedPublicly?: boolean;
  publicName?: string;
  showAmount?: boolean;
  anonymous?: boolean;
  guestName: string;
};

export type RecognitionState = {
  namedPublicly: boolean;
  publicName: string;
  moderatedName: string;
  showAmount: boolean;
  hiddenByHost: boolean;
};

/**
 * Opt-in is off unless the guest says otherwise.
 * A legacy `anonymous: false` (the old checkbox) still publishes the guest name.
 * Omitting every flag leaves the saved choice alone.
 */
export function recognitionPatch(
  current: RecognitionState,
  input: RecognitionInput,
): ({ ok: true; touched: boolean } & RecognitionState) | { ok: false; error: string } {
  const touched =
    input.namedPublicly !== undefined ||
    input.anonymous !== undefined ||
    input.publicName !== undefined ||
    input.showAmount !== undefined;
  if (!touched) return { ok: true, touched: false, ...current };
  let named = current.namedPublicly;
  if (input.namedPublicly !== undefined) named = input.namedPublicly;
  else if (input.anonymous !== undefined) named = !input.anonymous;
  let publicName = current.publicName;
  if (input.publicName !== undefined) {
    const cleaned = cleanPublicName(input.publicName);
    if (!cleaned.ok) return cleaned;
    publicName = cleaned.name;
  }
  if (named && !publicName.trim()) publicName = input.guestName.trim().slice(0, 80);
  let moderatedName = current.moderatedName;
  if (input.publicName !== undefined && publicName.trim() !== current.moderatedName.trim()) {
    moderatedName = "";
  }
  const showAmount = input.showAmount !== undefined ? Boolean(named && input.showAmount) : current.showAmount;
  return {
    ok: true,
    touched: true,
    namedPublicly: named,
    publicName,
    moderatedName,
    showAmount,
    hiddenByHost: current.hiddenByHost,
  };
}

type ProfileRow = {
  id: string;
  name: string;
  recognize_public: boolean;
  public_name: string;
  show_pledge_amount: boolean;
  recognition_hidden: boolean;
  recognition_name: string;
};

function profileOf(row: ProfileRow): DonorProfile {
  return {
    guestId: row.id,
    guestName: row.name,
    namedPublicly: Boolean(row.recognize_public),
    publicName: row.public_name ?? "",
    moderatedName: row.recognition_name ?? "",
    showAmount: Boolean(row.show_pledge_amount),
    hiddenByHost: Boolean(row.recognition_hidden),
  };
}

async function loadRows(eventId: string, includeHiddenNeeds: boolean): Promise<{ gifts: Gift[]; profiles: DonorProfile[] }> {
  const giftsRes = await pool.query(
    `SELECT p.guest_id, p.need_id, p.amount,
            (p.undone_at IS NULL AND p.voided_at IS NULL) AS active
     FROM pledges p
     JOIN needs n ON n.id = p.need_id
     WHERE n.event_id = $1 AND ($2::boolean OR n.hidden = false)`,
    [eventId, includeHiddenNeeds],
  );
  const profilesRes = await pool.query(
    `SELECT id, name, recognize_public, public_name, show_pledge_amount, recognition_hidden, recognition_name
     FROM guests WHERE event_id = $1`,
    [eventId],
  );
  return {
    gifts: giftsRes.rows.map((r) => ({
      guestId: r.guest_id as string,
      needId: r.need_id as string,
      amount: r.amount as string,
      active: Boolean(r.active),
    })),
    profiles: (profilesRes.rows as ProfileRow[]).map(profileOf),
  };
}

export async function publicRecognition(eventId: string, opts: { enabled: boolean; limit: number }) {
  const { gifts, profiles } = await loadRows(eventId, false);
  const byNeed = new Map<string, { donors: PublicSupporter[]; anonymousGifts: number }>();
  const needIds = new Set(gifts.map((g) => g.needId));
  for (const needId of needIds) {
    const listed = supportersForNeed(needId, gifts, profiles, opts.enabled);
    byNeed.set(needId, {
      donors: opts.enabled ? listed.donors.map(toPublicSupporter) : [],
      anonymousGifts: opts.enabled ? listed.anonymousGifts : 0,
    });
  }
  const top = rankDonors(gifts, profiles, opts.limit, opts.enabled).map(toPublicTop);
  return { byNeed, topDonors: top };
}

export type HostDonor = {
  guestId: string;
  guestName: string;
  namedPublicly: boolean;
  publicName: string;
  moderatedName: string;
  showAmount: boolean;
  hidden: boolean;
  total: number;
  audit: Array<{ id: string; action: string; publicName: string | null; previousName: string | null; reason: string | null; actor: string; createdAt: string }>;
};

export async function hostDonorBoard(eventId: string): Promise<HostDonor[]> {
  const { gifts, profiles } = await loadRows(eventId, true);
  const totals = new Map<string, number>();
  for (const gift of gifts) {
    if (!gift.active) continue;
    totals.set(gift.guestId, money((totals.get(gift.guestId) ?? 0) + money(gift.amount)));
  }
  const audits = await pool.query(
    `SELECT id, guest_id, action, public_name, previous_name, reason, actor, created_at
     FROM recognition_audit WHERE event_id = $1 ORDER BY created_at DESC`,
    [eventId],
  );
  const byGuest = new Map<string, HostDonor["audit"]>();
  for (const r of audits.rows) {
    const id = r.guest_id as string | null;
    if (!id) continue;
    const list = byGuest.get(id) ?? [];
    list.push({
      id: r.id as string,
      action: r.action as string,
      publicName: (r.public_name as string | null) ?? null,
      previousName: (r.previous_name as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      actor: r.actor as string,
      createdAt: new Date(r.created_at as string).toISOString(),
    });
    byGuest.set(id, list);
  }
  return profiles
    .filter((p) => totals.has(p.guestId))
    .map((p) => ({
      guestId: p.guestId,
      guestName: p.guestName,
      namedPublicly: p.namedPublicly,
      publicName: p.publicName,
      moderatedName: p.moderatedName,
      showAmount: p.showAmount,
      hidden: p.hiddenByHost,
      total: totals.get(p.guestId) ?? 0,
      audit: byGuest.get(p.guestId) ?? [],
    }))
    .sort((a, b) => b.total - a.total || a.guestName.localeCompare(b.guestName));
}

export async function readGuestRecognition(client: PoolClient, guestId: string): Promise<RecognitionState> {
  const { rows } = await client.query(
    `SELECT recognize_public, public_name, show_pledge_amount, recognition_hidden, recognition_name
     FROM guests WHERE id = $1`,
    [guestId],
  );
  const r = rows[0];
  return {
    namedPublicly: Boolean(r?.recognize_public),
    publicName: (r?.public_name as string) ?? "",
    moderatedName: (r?.recognition_name as string) ?? "",
    showAmount: Boolean(r?.show_pledge_amount),
    hiddenByHost: Boolean(r?.recognition_hidden),
  };
}

export async function writeGuestRecognition(
  client: PoolClient,
  opts: { eventId: string; guestId: string; guestName: string; actor: string; input: RecognitionInput },
): Promise<RecognitionState & { displayName: string; namedOnScreen: boolean }> {
  const current = await readGuestRecognition(client, opts.guestId);
  const patch = recognitionPatch(current, opts.input);
  if (!patch.ok) throw Object.assign(new Error(patch.error), { statusCode: 400 });
  if (patch.touched) {
    await client.query(
      `UPDATE guests
       SET recognize_public = $2, public_name = $3, show_pledge_amount = $4, recognition_name = $5
       WHERE id = $1`,
      [opts.guestId, patch.namedPublicly, patch.publicName, patch.showAmount, patch.moderatedName],
    );
    await client.query(
      `INSERT INTO recognition_audit
         (event_id, guest_id, action, public_name, previous_name, recognize_public, show_amount, hidden, actor)
       VALUES ($1,$2,'guest_update',$3,$4,$5,$6,$7,$8)`,
      [
        opts.eventId,
        opts.guestId,
        visibleName({ ...patch, guestId: opts.guestId, guestName: opts.guestName }) ?? patch.publicName,
        visibleName({ ...current, guestId: opts.guestId, guestName: opts.guestName }),
        patch.namedPublicly,
        patch.showAmount,
        patch.hiddenByHost,
        opts.actor,
      ],
    );
  }
  const state: RecognitionState = {
    namedPublicly: patch.namedPublicly,
    publicName: patch.publicName,
    moderatedName: patch.moderatedName,
    showAmount: patch.showAmount,
    hiddenByHost: patch.hiddenByHost,
  };
  const display = visibleName({ ...state, guestId: opts.guestId, guestName: opts.guestName });
  return { ...state, displayName: display ?? ANONYMOUS_LABEL, namedOnScreen: display != null };
}

export async function saveGuestRecognition(opts: {
  eventId: string;
  guestId: string;
  guestName: string;
  input: RecognitionInput;
}): Promise<RecognitionState & { displayName: string; namedOnScreen: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = await writeGuestRecognition(client, { ...opts, actor: `guest:${opts.guestId}` });
    await client.query("COMMIT");
    return saved;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already finished */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function moderateDonor(opts: {
  eventId: string;
  guestId: string;
  hostEmail: string;
  reason: string;
  name?: string;
  hidden?: boolean;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const guest = await client.query(
      `SELECT id, event_id, name, recognize_public, public_name, recognition_name, recognition_hidden, show_pledge_amount
       FROM guests WHERE id = $1 AND event_id = $2 FOR UPDATE`,
      [opts.guestId, opts.eventId],
    );
    const row = guest.rows[0] as (ProfileRow & { event_id: string }) | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Guest not found"), { statusCode: 404 });
    }
    let moderated = row.recognition_name ?? "";
    let hidden = Boolean(row.recognition_hidden);
    let action: "host_edit" | "host_hide" | "host_restore" = "host_edit";
    if (opts.name !== undefined) {
      const cleaned = cleanPublicName(opts.name);
      if (!cleaned.ok) {
        await client.query("ROLLBACK");
        throw Object.assign(new Error(cleaned.error), { statusCode: 400 });
      }
      moderated = cleaned.name;
      action = "host_edit";
    }
    if (opts.hidden !== undefined) {
      hidden = opts.hidden;
      action = opts.hidden ? "host_hide" : "host_restore";
    }
    const previous = visibleName(profileOf(row));
    await client.query(
      `UPDATE guests SET recognition_name = $2, recognition_hidden = $3 WHERE id = $1`,
      [row.id, moderated, hidden],
    );
    const next = visibleName(
      profileOf({ ...row, recognition_name: moderated, recognition_hidden: hidden }),
    );
    await client.query(
      `INSERT INTO recognition_audit
         (event_id, guest_id, action, public_name, previous_name, recognize_public, show_amount, hidden, reason, actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opts.eventId,
        row.id,
        action,
        next ?? moderated,
        previous,
        row.recognize_public,
        row.show_pledge_amount,
        hidden,
        opts.reason,
        opts.hostEmail,
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already finished */ }
    throw e;
  } finally {
    client.release();
  }
}
