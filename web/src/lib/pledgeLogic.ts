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

export type ScreenFrame = "auction" | "needs" | "donors";

/**
 * Big-screen frame. A need spotlight, or a pledge that just landed, holds Fund-a-Need.
 * A Top Donors spotlight holds that frame. Otherwise the room rotates auction, needs, donors.
 */
export function bigScreenFrame(
  step: number,
  needCount: number,
  spotlight: boolean,
  pinnedNeed: boolean,
  donors = false,
  spotlightDonors = false,
): ScreenFrame {
  if (spotlightDonors) return "donors";
  if (needCount <= 0 && !donors) return "auction";
  if ((spotlight || pinnedNeed) && needCount > 0) return "needs";
  const frames: ScreenFrame[] = ["auction"];
  if (needCount > 0) frames.push("needs");
  if (donors) frames.push("donors");
  return frames[step % frames.length];
}

/** Names that just entered the top 3, or moved up inside it. */
export function recognitionMoves(
  prev: Array<{ name: string; rank: number }>,
  next: Array<{ name: string; rank: number }>,
): string[] {
  const before = new Map(prev.map((d) => [d.name, d.rank]));
  const moved: string[] = [];
  for (const d of next) {
    if (d.rank > 3) continue;
    const was = before.get(d.name);
    if (was == null || was > d.rank) moved.push(d.name);
  }
  return moved;
}

export function anonymousGiftLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "+ 1 anonymous gift";
  return `+ ${count} anonymous gifts`;
}
