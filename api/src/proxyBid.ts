import type { PoolClient } from "pg";
import { money } from "./auction.js";

export type BidSnap = { guestId: string; amount: number; at: number };
export type MaxSnap = { guestId: string; max: number; at: number };

/** A bid the resolver wants written. `aheadOfTies` keeps an earlier max ahead of an equal amount. */
export type ProxyInsert = { guestId: string; amount: number; aheadOfTies: boolean };

type Ceiling = { guestId: string; amount: number; at: number; hasMax: boolean; max: number };

/**
 * Proxy price for one lot.
 * The higher maximum leads. An equal maximum loses to the one that was set earlier.
 * The public price is one increment above the second ceiling, and never above the winner's maximum.
 * A lone maximum bids only the minimum (the starting bid, or the current high).
 */
export function planProxyBids(opts: {
  startingBid: number;
  increment: number;
  buyNow: number | null;
  bids: BidSnap[];
  maxes: MaxSnap[];
}): ProxyInsert[] {
  const startingBid = money(opts.startingBid);
  const increment = money(opts.increment);
  const buyNow = opts.buyNow == null ? null : money(opts.buyNow);
  if (!(increment > 0) || !(startingBid > 0)) return [];

  const highest = new Map<string, number>();
  const byGuest = new Map<string, Ceiling>();
  for (const b of opts.bids) {
    const amount = money(b.amount);
    const prev = highest.get(b.guestId) ?? 0;
    if (amount > prev) highest.set(b.guestId, amount);
    const cur = byGuest.get(b.guestId);
    if (!cur || amount > cur.amount || (amount === cur.amount && b.at < cur.at)) {
      byGuest.set(b.guestId, { guestId: b.guestId, amount, at: b.at, hasMax: false, max: 0 });
    }
  }
  for (const m of opts.maxes) {
    const max = money(m.max);
    const cur = byGuest.get(m.guestId);
    const bidAmount = cur?.amount ?? 0;
    const ceiling = Math.max(max, bidAmount);
    const at = bidAmount > max && cur ? cur.at : m.at;
    byGuest.set(m.guestId, { guestId: m.guestId, amount: ceiling, at, hasMax: true, max });
  }

  const ranked = [...byGuest.values()].sort((a, b) => b.amount - a.amount || a.at - b.at);
  const winner = ranked[0];
  if (!winner) return [];
  const second = ranked[1];

  const currentHigh = opts.bids.reduce((m, b) => Math.max(m, money(b.amount)), 0);
  const bidCount = opts.bids.length;
  let price: number;
  if (!second) {
    price = bidCount === 0 ? startingBid : currentHigh;
    const holder = leaderId(opts.bids);
    if (holder && holder !== winner.guestId) price = money(currentHigh + increment);
  } else if (money(second.amount) === money(winner.amount)) {
    price = winner.amount;
  } else {
    price = Math.min(winner.amount, money(second.amount + increment));
  }
  if (buyNow != null && price >= buyNow) price = buyNow;
  if (bidCount > 0 && price < currentHigh) price = currentHigh;
  if (price + 0.001 < startingBid) return [];
  if (winner.amount + 0.001 < price) return [];

  const held = (id: string) => highest.get(id) ?? 0;
  const inserts: ProxyInsert[] = [];
  const tie = Boolean(second && money(second.amount) === money(winner.amount));

  for (const m of opts.maxes) {
    if (m.guestId === winner.guestId) continue;
    if (tie && second && m.guestId === second.guestId) continue;
    const cap = money(m.max);
    if (cap + 0.001 >= price) continue;
    if (cap + 0.001 < startingBid) continue;
    if (held(m.guestId) + 0.001 < cap) inserts.push({ guestId: m.guestId, amount: cap, aheadOfTies: false });
  }

  if (winner.hasMax && held(winner.guestId) + 0.001 < price && price <= Math.max(winner.max, held(winner.guestId)) + 0.001) {
    inserts.push({ guestId: winner.guestId, amount: price, aheadOfTies: tie });
  }
  if (tie && second?.hasMax && held(second.guestId) + 0.001 < price) {
    inserts.push({ guestId: second.guestId, amount: price, aheadOfTies: false });
  }
  return inserts;
}

function leaderId(bids: BidSnap[]): string | null {
  let best: BidSnap | null = null;
  for (const b of bids) {
    if (!best || money(b.amount) > money(best.amount) || (money(b.amount) === money(best.amount) && b.at < best.at)) best = b;
  }
  return best?.guestId ?? null;
}

/** Second place, and within a single increment of the high bid. */
export function soCloseOffer(opts: {
  bids: BidSnap[];
  guestId: string;
  increment: number;
}): { amount: number } | null {
  if (!opts.bids.length) return null;
  const ranked = [...opts.bids].sort((a, b) => money(b.amount) - money(a.amount) || a.at - b.at);
  const top = ranked[0];
  if (!top || top.guestId === opts.guestId) return null;
  const mine = ranked.findIndex((b) => b.guestId === opts.guestId);
  if (mine !== 1) return null;
  const gap = money(top.amount - ranked[mine].amount);
  if (gap <= 0 || gap > money(opts.increment) + 0.001) return null;
  return { amount: money(top.amount + opts.increment) };
}

/**
 * Place the planned proxy bids inside the caller's transaction.
 * The item row must already be locked. Equal timestamps cannot break a tie, so the
 * earlier maximum is written 1ms before any bid already at that amount.
 */
export async function applyProxyBids(
  client: PoolClient,
  item: { id: string; starting_bid: number | string; min_increment: number | string; buy_now: number | string | null },
): Promise<{ leaderGuestId: string | null }> {
  const bidsRes = await client.query(
    "SELECT guest_id, amount, created_at FROM bids WHERE item_id = $1",
    [item.id],
  );
  const maxRes = await client.query(
    "SELECT guest_id, max_amount, created_at FROM max_bids WHERE item_id = $1 AND cancelled_at IS NULL",
    [item.id],
  );
  const bids: BidSnap[] = bidsRes.rows.map((r) => ({
    guestId: r.guest_id as string,
    amount: money(r.amount),
    at: new Date(r.created_at).getTime(),
  }));
  const maxes: MaxSnap[] = maxRes.rows.map((r) => ({
    guestId: r.guest_id as string,
    max: money(r.max_amount),
    at: new Date(r.created_at).getTime(),
  }));
  const inserts = planProxyBids({
    startingBid: money(item.starting_bid),
    increment: money(item.min_increment),
    buyNow: item.buy_now == null ? null : money(item.buy_now),
    bids,
    maxes,
  });
  for (const row of inserts) {
    if (row.aheadOfTies) {
      await client.query(
        `INSERT INTO bids (item_id, guest_id, amount, source, created_at)
         VALUES ($1, $2, $3, 'proxy',
           COALESCE((SELECT MIN(created_at) FROM bids WHERE item_id = $1 AND amount = $3), clock_timestamp())
           - interval '1 millisecond')`,
        [item.id, row.guestId, row.amount],
      );
    } else {
      await client.query(
        `INSERT INTO bids (item_id, guest_id, amount, source, created_at)
         VALUES ($1, $2, $3, 'proxy', clock_timestamp())`,
        [item.id, row.guestId, row.amount],
      );
    }
  }
  const top = await client.query(
    "SELECT guest_id FROM bids WHERE item_id = $1 ORDER BY amount DESC, created_at ASC LIMIT 1",
    [item.id],
  );
  return { leaderGuestId: (top.rows[0]?.guest_id as string | undefined) ?? null };
}
