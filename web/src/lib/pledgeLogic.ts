/** Guest-side Fund-a-Need helpers. Money rules that move money live in the API. */

export type RaisedStats = {
  totalHighBids: number;
  totalDonations?: number;
  totalRaised?: number;
};

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The figure on the raised card: auction high bids plus active pledges. */
export function raisedSplit(stats: RaisedStats): { auction: number; donations: number; total: number } {
  const auction = money(stats.totalHighBids);
  const donations = money(stats.totalDonations ?? 0);
  const total = stats.totalRaised == null ? money(auction + donations) : money(stats.totalRaised);
  return { auction, donations, total };
}

export function pledgedNeedIds(pledges: Array<{ needId: string }> | undefined): string[] {
  return [...new Set((pledges ?? []).map((p) => p.needId))];
}

export function pledgeTotal(pledges: Array<{ amount: number }> | undefined): number {
  return money((pledges ?? []).reduce((s, p) => s + p.amount, 0));
}

/** −/+ on a unit stepper. Never below 1. */
export function stepUnits(current: number, dir: 1 | -1, max = 999): number {
  const n = Number.isFinite(current) ? current : 1;
  return Math.min(max, Math.max(1, n + dir));
}

export function unitsCost(units: number, unitAmount: number): number {
  return money(units * unitAmount);
}

/**
 * Big-screen frame. Spotlight (or a pledge that just landed) stays on Fund-a-Need.
 * Otherwise the room alternates with the auction highlight.
 */
export function bigScreenFrame(
  step: number,
  needCount: number,
  spotlight: boolean,
  pinnedNeed: boolean,
): "auction" | "needs" {
  if (needCount <= 0) return "auction";
  if (spotlight || pinnedNeed) return "needs";
  return step % 2 === 0 ? "auction" : "needs";
}
