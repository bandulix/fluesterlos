/** Pure helpers for the big screen (EngagerPage): paged item grid, hot items, sponsor pages. */

export const BOARD_PAGE_MS = 8000;
export const BOARD_MIN_PER_PAGE = 8;
export const BOARD_MAX_PER_PAGE = 12;
export const HOT_WINDOW_MS = 5 * 60_000;

export type GridFit = { cols: number; rows: number; perPage: number; cardH: number };

/**
 * How many cards fit the board: as many columns of at least `minCardW` as the width allows and as
 * many rows of at least `minCardH` as the height allows, capped at 12 per page so cards stay
 * readable from the back of the room. Never 0 (a tiny board still shows one card per page).
 * `cardH` then stretches the rows to fill the height (up to `maxCardH`), so a short screen never
 * leaves an empty band under the grid.
 */
export function gridFit(
  width: number,
  height: number,
  minCardW: number,
  minCardH: number,
  gap: number,
  max = BOARD_MAX_PER_PAGE,
  maxCardH = 132,
): GridFit {
  let cols = Math.max(1, Math.floor((width + gap) / (minCardW + gap)));
  let rows = Math.max(1, Math.floor((height + gap) / (minCardH + gap)));
  // Over the cap: give up columns first (wider cards read better than an empty band at the bottom).
  while (cols * rows > max) {
    if (cols > rows && cols > 1) cols--;
    else if (rows > 1) rows--;
    else break;
  }
  // A short board used to force cardH up to minCardH and paint a row past the panel.
  // Drop rows until one minimum card fits; if even one row is too tall, shrink it.
  const used = (r: number) => gap * Math.max(0, r - 1);
  while (rows > 1 && height - used(rows) < minCardH * rows) rows--;
  const perPage = Math.max(1, Math.min(cols * rows, max));
  const raw = Math.floor((height - used(rows)) / Math.max(1, rows));
  const fill = Number.isFinite(raw) ? raw : minCardH;
  const cardH = fill >= minCardH ? Math.min(maxCardH, fill) : Math.max(1, fill);
  return { cols, rows, perPage, cardH };
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

export function pageSlice<T>(list: T[], page: number, perPage: number): T[] {
  const pages = pageCount(list.length, perPage);
  const p = ((page % pages) + pages) % pages;
  return list.slice(p * perPage, p * perPage + perPage);
}

export type HotInput = { id: string; bidCount: number; soldViaBuyNow?: boolean };
export type RecentBid = { itemId?: string; createdAt: string };

/**
 * "Hot" items: most recent bidding activity (bids in the last 5 minutes weigh 3×) plus total bids.
 * Only items with bids qualify; sold buy-now items are not hot any more. Returns up to `limit` ids,
 * hottest first.
 */
export function hotItemIds(items: HotInput[], recent: RecentBid[], now: number, limit = 3): string[] {
  const recentCount = new Map<string, number>();
  for (const b of recent) {
    if (!b.itemId) continue;
    const t = Date.parse(b.createdAt);
    if (Number.isFinite(t) && now - t <= HOT_WINDOW_MS) recentCount.set(b.itemId, (recentCount.get(b.itemId) ?? 0) + 1);
  }
  return items
    .filter((it) => it.bidCount > 0 && !it.soldViaBuyNow)
    .map((it, i) => ({ id: it.id, i, score: (recentCount.get(it.id) ?? 0) * 3 + it.bidCount }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.id);
}

export function chunk<T>(list: T[], size: number): T[][] {
  const n = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export type TopLotItem = { highBid: number; bidCount: number; soldViaBuyNow?: boolean; sortOrder: number };

/**
 * Highest winning bid among sold lots. A lot counts once it has a bid or sold via buy-now.
 * Equal prices keep the earlier lot (lower catalogue order).
 */
export function topLot<T extends TopLotItem>(items: T[]): T | undefined {
  let best: T | undefined;
  for (const it of items) {
    if (!(it.bidCount > 0 || it.soldViaBuyNow)) continue;
    if (!best || it.highBid > best.highBid || (it.highBid === best.highBid && it.sortOrder < best.sortOrder)) best = it;
  }
  return best;
}

export type SpotItem = { id: string; bidCount: number; soldViaBuyNow?: boolean };

/**
 * Which item the spotlight shows at rotation step `step`: mostly items that are being bid on
 * (newest bid first, then the rest with bids), and every third step an item still waiting for its
 * first bid — so the room sees the action but unbid prizes still get airtime. Without any bids it
 * simply cycles through all items.
 */
export function spotlightAt<T extends SpotItem>(step: number, items: T[], recent: RecentBid[]): T | undefined {
  if (!items.length) return undefined;
  const byId = new Map(items.map((it) => [it.id, it]));
  const active: T[] = [];
  const seen = new Set<string>();
  for (const b of recent) {
    const it = b.itemId ? byId.get(b.itemId) : undefined;
    if (it && it.bidCount > 0 && !it.soldViaBuyNow && !seen.has(it.id)) {
      seen.add(it.id);
      active.push(it);
    }
  }
  for (const it of [...items].sort((a, b) => b.bidCount - a.bidCount)) {
    if (it.bidCount > 0 && !it.soldViaBuyNow && !seen.has(it.id)) {
      seen.add(it.id);
      active.push(it);
    }
  }
  const waiting = items.filter((it) => it.bidCount === 0);
  const n = Math.max(0, step);
  if (!active.length) return (waiting.length ? waiting : items)[n % (waiting.length || items.length)];
  if (waiting.length && n % 3 === 2) return waiting[Math.floor(n / 3) % waiting.length];
  return active[(n - Math.floor((n + 1) / 3)) % active.length];
}

export type SpotlightText = { label: string; amount: number; sub: string };

/** The spotlight's label / amount / sub-line, from that item's own state. */
export function spotlightText(
  it: { bidCount: number; highBid: number; startingBid: number; buyNow: number | null; soldViaBuyNow?: boolean; highBidder?: string | null },
  closed: boolean,
): SpotlightText {
  const fixed = it.buyNow != null && it.buyNow === it.startingBid;
  if (it.soldViaBuyNow) return { label: fixed ? "Sold at fixed price" : "Sold (buy now)", amount: it.highBid, sub: it.highBidder ? `Bought by ${it.highBidder}` : "Sold" };
  if (it.bidCount > 0) {
    const bids = `${it.bidCount} ${it.bidCount === 1 ? "bid" : "bids"}`;
    return closed
      ? { label: "Winning bid", amount: it.highBid, sub: `Won by ${it.highBidder ?? "—"} · ${bids}` }
      : { label: "Current bid", amount: it.highBid, sub: `Leading: ${it.highBidder ?? "—"} · ${bids}` };
  }
  if (fixed) return { label: "Fixed price", amount: it.buyNow!, sub: closed ? "Not sold" : "Buy it now — scan to bid" };
  return { label: "Starting bid", amount: it.startingBid, sub: closed ? "No bids" : "No bids yet — be the first!" };
}
