import type { GuestMe, LiveItem } from "./api";

export type ItemStatus = "winning" | "outbid" | null;
export type FilterKey = "all" | "mine" | "winning" | "outbid";
export const FILTERS: FilterKey[] = ["all", "mine", "winning", "outbid"];

/** The next valid bid: starting bid when nobody bid yet, else high + increment. */
export function minNextBid(it: Pick<LiveItem, "bidCount" | "startingBid" | "highBid" | "minIncrement">): number {
  return it.bidCount === 0 ? it.startingBid : it.highBid + it.minIncrement;
}

export function itemStatus(it: Pick<LiveItem, "id" | "leaderKey">, me: GuestMe | null | undefined): ItemStatus {
  if (!me?.leaderKey) return null;
  if (it.leaderKey && it.leaderKey === me.leaderKey) return "winning";
  if (me.bidItemIds?.includes(it.id)) return "outbid";
  return null;
}

export function filterItems<T extends Pick<LiveItem, "id" | "leaderKey">>(items: T[], filter: FilterKey, me: GuestMe | null | undefined): T[] {
  if (filter === "all") return items;
  return items.filter((it) => {
    const st = itemStatus(it, me);
    if (filter === "mine") return st !== null;
    return st === filter;
  });
}

export function filterCounts(items: Array<Pick<LiveItem, "id" | "leaderKey">>, me: GuestMe | null | undefined): Record<FilterKey, number> {
  const c: Record<FilterKey, number> = { all: items.length, mine: 0, winning: 0, outbid: 0 };
  for (const it of items) {
    const st = itemStatus(it, me);
    if (st) c.mine += 1;
    if (st === "winning") c.winning += 1;
    if (st === "outbid") c.outbid += 1;
  }
  return c;
}

type Biddable = Pick<LiveItem, "bidCount" | "startingBid" | "highBid" | "minIncrement" | "buyNow">;

/**
 * The amount on the big button: the guest's stepped amount, but never below the current minimum
 * (the high bid may have moved while they looked) and never above buy-now.
 */
export function effectiveAmount(chosen: number | undefined, it: Biddable): number {
  const min = minNextBid(it);
  let amount = chosen == null || chosen < min ? min : chosen;
  if (it.buyNow != null && amount > it.buyNow) amount = Math.max(min, it.buyNow);
  return amount;
}

/** +/- stepper: one increment at a time, clamped to [minimum, buy-now]. */
export function stepAmount(current: number, dir: 1 | -1, it: Biddable): number {
  return effectiveAmount(current + dir * it.minIncrement, it);
}

export function canStepDown(current: number, it: Biddable): boolean {
  return current > minNextBid(it);
}

export function canStepUp(current: number, it: Biddable): boolean {
  return it.buyNow == null || current < it.buyNow;
}

/** When the next normal bid reaches buy-now, buy-now is the only (and cheaper) way to win. */
export function onlyBuyNow(it: Biddable): boolean {
  return it.buyNow != null && minNextBid(it) >= it.buyNow;
}

/** Items that just went from "winning" to "outbid" (for the banner + vibration). */
export function newlyOutbid(prev: Record<string, ItemStatus>, next: Record<string, ItemStatus>): string[] {
  return Object.keys(next).filter((id) => prev[id] === "winning" && next[id] === "outbid");
}

export function statusMap(items: Array<Pick<LiveItem, "id" | "leaderKey">>, me: GuestMe | null | undefined): Record<string, ItemStatus> {
  const out: Record<string, ItemStatus> = {};
  for (const it of items) out[it.id] = itemStatus(it, me);
  return out;
}

export function wonItems<T extends Pick<LiveItem, "id" | "leaderKey">>(items: T[], me: GuestMe | null | undefined): T[] {
  return items.filter((it) => itemStatus(it, me) === "winning");
}

/** Server clock minus device clock (ms), so countdowns follow the server, not a wrong phone clock. */
export function clockOffset(serverNowIso: string | undefined, receivedAt: number): number {
  const s = serverNowIso ? Date.parse(serverNowIso) : NaN;
  return Number.isFinite(s) ? s - receivedAt : 0;
}

/** Short haptic nudge where supported (Android); silently nothing on iOS / LINE. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

export type EventStatus = "scheduled" | "open" | "closed";

/** Status at `now` (server-corrected): the board flips at the exact second without waiting for a push. */
export function statusAt(ev: { status: EventStatus; startsAt: string; endsAt: string }, now: number): EventStatus {
  if (ev.status === "closed") return "closed";
  const start = Date.parse(ev.startsAt);
  const end = Date.parse(ev.endsAt);
  if (Number.isFinite(end) && now >= end) return "closed";
  if (ev.status === "scheduled" && Number.isFinite(start) && now < start) return "scheduled";
  return "open";
}

/** "1:05:09", "05:09" — hours only when needed. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
