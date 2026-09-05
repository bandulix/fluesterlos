export type AuctionStatus = "scheduled" | "open" | "closed";

export function auctionStatus(startsAt: Date | string, endsAt: Date | string, now = new Date()): AuctionStatus {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const t = now.getTime();
  if (t < start) return "scheduled";
  if (t >= end) return "closed";
  return "open";
}

export function money(n: number | string): number {
  return Math.round(Number(n) * 100) / 100;
}
