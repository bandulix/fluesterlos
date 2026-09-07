export type AuctionStatus = "scheduled" | "open" | "closed";

export const CURRENCIES = ["USD", "EUR", "THB"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function parseCurrency(raw: unknown): Currency {
  const v = String(raw ?? "").toUpperCase();
  return v === "USD" || v === "EUR" || v === "THB" ? v : "THB";
}

export function formatMoney(amount: number | string, currency: Currency = "THB"): string {
  const n = money(amount);
  const symbol: Record<Currency, string> = { USD: "$", EUR: "€", THB: "฿" };
  return `${symbol[currency]}${n.toFixed(2)}`;
}

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
