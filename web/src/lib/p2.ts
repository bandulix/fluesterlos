/** Six-digit join code. Boxes share this so paste, autofill and backspace stay consistent. */
export const OTP_LEN = 6;

export function otpDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LEN);
}

export function otpType(slots: string[], index: number, raw: string): { slots: string[]; focus: number } {
  const incoming = otpDigits(raw);
  const next = slots.slice(0, OTP_LEN);
  while (next.length < OTP_LEN) next.push("");
  if (!incoming) return { slots: next, focus: index };
  const start = incoming.length >= OTP_LEN ? 0 : index;
  for (let i = 0; i < incoming.length && start + i < OTP_LEN; i++) next[start + i] = incoming[i] ?? "";
  const focus = Math.min(OTP_LEN - 1, start + incoming.length);
  return { slots: next, focus: incoming.length === 1 ? Math.min(OTP_LEN - 1, index + 1) : focus };
}

export function otpBackspace(slots: string[], index: number): { slots: string[]; focus: number } {
  const next = slots.slice(0, OTP_LEN);
  while (next.length < OTP_LEN) next.push("");
  if (next[index]) {
    next[index] = "";
    return { slots: next, focus: index };
  }
  if (index === 0) return { slots: next, focus: 0 };
  next[index - 1] = "";
  return { slots: next, focus: index - 1 };
}

export function otpValue(slots: string[]): string {
  return slots.join("");
}

export const FINAL_MS = 5 * 60 * 1000;

/** Relative time for a bid, as an i18n key. Under 45 seconds is "just now". */
export function relativeAgo(seconds: number): { key: "time.justNow" | "time.minutesAgo" | "time.hoursAgo" | "time.daysAgo"; n?: number } {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  if (s < 60) return { key: "time.justNow" };
  const m = Math.floor(s / 60);
  if (m < 60) return { key: "time.minutesAgo", n: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { key: "time.hoursAgo", n: h };
  return { key: "time.daysAgo", n: Math.floor(h / 24) };
}

/** Full-night ring. The last five minutes use the urgent colour. */
export function ringState(remainingMs: number, totalMs: number): { fraction: number; urgent: boolean } {
  const total = Math.max(1, totalMs);
  const fraction = Math.max(0, Math.min(1, remainingMs / total));
  return { fraction, urgent: remainingMs > 0 && remainingMs <= FINAL_MS };
}

/** Custom bid: a number at or above the next minimum. */
export function customBidAmount(raw: string, min: number): { ok: true; amount: number } | { ok: false } {
  const n = Number(String(raw).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return { ok: false };
  const amount = Math.round(n * 100) / 100;
  if (amount + 0.001 < min) return { ok: false };
  return { ok: true, amount };
}

/** Called level, plus the neighbour on each side. Highest-first, same order as the server. */
export function paddleTiles(levels: number[], index: number): number[] {
  if (!levels.length) return [];
  const i = Math.max(0, Math.min(levels.length - 1, index));
  const tiles: number[] = [];
  if (i > 0) tiles.push(levels[i - 1]!);
  tiles.push(levels[i]!);
  if (i + 1 < levels.length) tiles.push(levels[i + 1]!);
  return tiles;
}

export function hostNextActions(input: {
  status: string;
  paddle: "off" | "live" | "paused" | "ended" | null;
  openLots: number;
}): { paddle: "start" | "next" | "none"; closeLot: boolean; closeAuction: boolean } {
  const open = input.status === "open";
  const paddle = !open ? "none" : input.paddle === "live" || input.paddle === "paused" ? "next" : "start";
  return {
    paddle,
    closeLot: open && input.openLots > 0,
    closeAuction: open,
  };
}
