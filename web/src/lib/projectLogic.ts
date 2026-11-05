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
