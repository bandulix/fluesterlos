/** Progress for one trade or a whole project. Amounts are minor-unit safe to the cent. */
export function tradeProgress(target: number, raised: number) {
  const goal = Math.round(target * 100) / 100;
  const got = Math.round(raised * 100) / 100;
  const remaining = Math.round(Math.max(0, goal - got) * 100) / 100;
  const percent = goal > 0 ? Math.min(100, Math.round((got / goal) * 1000) / 10) : 0;
  return { target: goal, raised: got, remaining, percent, funded: goal > 0 && remaining <= 0 };
}

export function projectProgress(trades: Array<{ target: number; raised: number }>) {
  const target = trades.reduce((sum, t) => sum + t.target, 0);
  const raised = trades.reduce((sum, t) => sum + t.raised, 0);
  return tradeProgress(target, raised);
}

const PLEDGE_ANCHORS = [1_000, 5_000, 10_000, 25_000, 50_000];

/** Set amounts below what is still open. The full remainder stays its own button. */
export function pledgePresets(remaining: number): number[] {
  const open = Math.round(remaining);
  return PLEDGE_ANCHORS.filter((n) => n > 0 && n < open).slice(0, 4);
}

/** The open trade closest to finished. People complete something they can see. */
export function nextOpenTrade<T extends { remaining: number; percent: number }>(trades: T[]): T | null {
  const open = trades.filter((t) => t.remaining > 0);
  if (!open.length) return null;
  return [...open].sort((a, b) => b.percent - a.percent || a.remaining - b.remaining)[0];
}
