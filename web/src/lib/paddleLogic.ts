/** What owns the big-screen main area. An active paddle raise keeps the countdown bar and replaces the rotating frames. */
export function roomMain(input: { countdownTakeover: boolean; paddleStatus?: string | null }): "paddle" | "countdown" | "room" {
  if (input.paddleStatus === "live" || input.paddleStatus === "paused") return "paddle";
  if (input.countdownTakeover) return "countdown";
  return "room";
}

/** Bar width for raised vs goal. Stays full once the goal is met. */
export function paddleProgress(raised: number, goal: number): number {
  if (!(goal > 0)) return 0;
  return Math.min(100, Math.max(0, (raised / goal) * 100));
}

export function paddleHit(raised: number, goal: number): boolean {
  return goal > 0 && raised + 0.001 >= goal;
}

/** Names that just appeared in the pop list. */
export function freshPops(prev: string[], next: string[]): string[] {
  const seen = new Set(prev);
  return next.filter((id) => !seen.has(id));
}
