/** Pure helpers for the big screen (EngagerPage): paged item grid, hot items, sponsor pages. */

export const BOARD_PAGE_MS = 8000;
export const BOARD_MIN_PER_PAGE = 8;
export const BOARD_MAX_PER_PAGE = 12;
export const HOT_WINDOW_MS = 5 * 60_000;

export type GridFit = { cols: number; rows: number; perPage: number };

/**
 * How many cards fit the board: as many columns of at least `minCardW` as the width allows and as
 * many rows of `cardH` as the height allows, capped at 12 per page so cards stay readable from the
 * back of the room. Never 0 (a tiny board still shows one card per page).
 */
export function gridFit(width: number, height: number, minCardW: number, cardH: number, gap: number, max = BOARD_MAX_PER_PAGE): GridFit {
  let cols = Math.max(1, Math.floor((width + gap) / (minCardW + gap)));
  let rows = Math.max(1, Math.floor((height + gap) / (cardH + gap)));
  // Over the cap: give up columns first (wider cards read better than an empty band at the bottom).
  while (cols * rows > max) {
    if (cols > rows && cols > 1) cols--;
    else if (rows > 1) rows--;
    else break;
  }
  const perPage = Math.max(1, Math.min(cols * rows, max));
  return { cols, rows, perPage };
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
