export const CURRENCIES = ["USD", "EUR", "THB"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_OPTIONS: Array<{ value: Currency; label: string }> = [
  { value: "USD", label: "US dollar ($)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "THB", label: "Thai baht (฿)" },
];

export function parseCurrency(raw: unknown): Currency {
  const v = String(raw ?? "").toUpperCase();
  return v === "USD" || v === "EUR" || v === "THB" ? v : "THB";
}

export function formatMoney(amount: number, currency: Currency = "THB"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const symbol: Record<Currency, string> = { USD: "$", EUR: "€", THB: "฿" };
  return `${symbol[currency]}${n.toFixed(2)}`;
}

/** Guest-facing amount: "฿2,000" (no decimals for whole amounts), "฿2,000.50" otherwise. */
export function formatAmount(amount: number, currency: Currency = "THB"): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const symbol: Record<Currency, string> = { USD: "$", EUR: "€", THB: "฿" };
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${symbol[currency]}${s}`;
}
