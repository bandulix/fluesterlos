import { money, type Currency } from "./auction.js";

/** Guest-visible undo window. The server refuses an undo after this many seconds. */
export const PLEDGE_UNDO_SECONDS = 10;

const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", THB: "฿" };

/** Guest-style amount: "฿1,000" for whole numbers, "฿1,000.50" otherwise. */
export function formatPledgeAmount(amount: number | string, currency: Currency = "THB"): string {
  const n = money(amount);
  const whole = Math.abs(n - Math.round(n)) < 0.001;
  const s = n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${SYMBOL[currency]}${s}`;
}

const IRREGULAR: Record<string, string> = {
  lunch: "lunches",
  child: "children",
  person: "people",
  class: "classes",
};

/** Singular unit label → phrase for `count` ("1 uniform" / "3 uniforms"). */
export function pluralUnit(label: string, count: number): string {
  const one = label.trim();
  if (count === 1 || !one) return one;
  const irregular = IRREGULAR[one.toLowerCase()];
  if (irregular) return irregular;
  if (/(ch|sh|x|z|s)$/i.test(one)) return `${one}es`;
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  return `${one}s`;
}

/**
 * Ticker name. Opt-in (`namedPublicly`) wins. Otherwise the legacy anonymous flag
 * still prints the guest name when it is explicitly false.
 */
export function pledgeWho(input: {
  anonymous?: boolean;
  guestName?: string;
  namedPublicly?: boolean;
  publicName?: string | null;
  hiddenByHost?: boolean;
}): string {
  if (input.hiddenByHost || input.namedPublicly === false) return "A guest";
  if (input.namedPublicly === true) return input.publicName?.trim() || "A guest";
  if (input.anonymous) return "A guest";
  return input.guestName?.trim() || "A guest";
}

export function pledgeTicker(input: {
  anonymous: boolean;
  guestName: string;
  units: number | null;
  unitLabel: string | null;
  amount: number | string;
  currency?: Currency;
  namedPublicly?: boolean;
  publicName?: string | null;
  hiddenByHost?: boolean;
}): string {
  const who = pledgeWho(input);
  if (input.units != null && input.units > 0 && input.unitLabel?.trim()) {
    return `${who} funded ${input.units} ${pluralUnit(input.unitLabel, input.units)}`;
  }
  return `${who} pledged ${formatPledgeAmount(input.amount, input.currency ?? "THB")}`;
}

export type FundingProgress = {
  /** Share of the target. May exceed 100 when pledges continue past the goal. */
  percent: number;
  /** Bar width, clamped at 100. */
  barPercent: number;
  fullyFunded: boolean;
  overFunded: boolean;
  /** "42% funded", "Fully funded!", or "110% funded". */
  label: string;
};

export function fundingProgress(raised: number | string, target: number | string): FundingProgress {
  const r = money(raised);
  const t = money(target);
  if (!(t > 0)) {
    return { percent: 0, barPercent: 0, fullyFunded: false, overFunded: false, label: "0% funded" };
  }
  const percent = Math.round((r / t) * 1000) / 10;
  const fullyFunded = r + 0.001 >= t;
  const overFunded = r > t + 0.001;
  const shown = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  const label = fullyFunded && !overFunded ? "Fully funded!" : `${shown}% funded`;
  return {
    percent,
    barPercent: Math.max(0, Math.min(100, percent)),
    fullyFunded,
    overFunded,
    label,
  };
}

/**
 * A need's end is its own time when the host set one, otherwise the event Fund-a-Need end.
 * Neither set → the need stays open after the auction closes.
 */
export function effectiveNeedEnd(
  needEndsAt: Date | string | null | undefined,
  eventEndsAt: Date | string | null | undefined,
): Date | null {
  const raw = needEndsAt ?? eventEndsAt ?? null;
  if (raw == null || raw === "") return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function needAcceptsPledges(opts: {
  hidden: boolean;
  closedAt: Date | string | null;
  endsAt: Date | string | null;
  now?: Date;
}): { ok: true } | { ok: false; error: string; code: "hidden" | "closed" | "ended" } {
  if (opts.hidden) return { ok: false, error: "Need not found", code: "hidden" };
  if (opts.closedAt) return { ok: false, error: "This need is closed", code: "closed" };
  const now = opts.now ?? new Date();
  if (opts.endsAt && new Date(opts.endsAt).getTime() <= now.getTime()) {
    return { ok: false, error: "Fund-a-Need has ended", code: "ended" };
  }
  return { ok: true };
}

export function pledgeCanUndo(createdAt: Date | string, now = new Date(), seconds = PLEDGE_UNDO_SECONDS): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= seconds * 1000;
}

export type ResolvedPledge =
  | { ok: true; amount: number; units: number | null }
  | { ok: false; error: string };

/**
 * Units win when the guest sends a count (amount = units × unit price).
 * Otherwise the amount must be at least the need's minimum.
 */
export function resolvePledge(input: {
  amount?: number | null;
  units?: number | null;
  unitAmount?: number | null;
  minPledge: number | string;
}): ResolvedPledge {
  const min = money(input.minPledge);
  if (!(min > 0)) return { ok: false, error: "This need has no minimum pledge" };
  if (input.units != null) {
    if (input.unitAmount == null || !(money(input.unitAmount) > 0)) {
      return { ok: false, error: "This need has no unit price" };
    }
    if (!Number.isInteger(input.units) || input.units < 1 || input.units > 100000) {
      return { ok: false, error: "Choose at least 1" };
    }
    const amount = money(input.units * money(input.unitAmount));
    if (amount < min) return { ok: false, error: `Minimum pledge is ${formatPledgeAmount(min)}` };
    return { ok: true, amount, units: input.units };
  }
  if (input.amount == null || !(Number(input.amount) > 0)) return { ok: false, error: "Enter an amount" };
  const amount = money(input.amount);
  if (amount < min) return { ok: false, error: `Minimum pledge is ${formatPledgeAmount(min)}` };
  return { ok: true, amount, units: null };
}

/**
 * When the host caps a need, a pledge that would pass the target is refused.
 * Uncapped needs accept pledges past 100%.
 */
export function pledgeFitsCap(opts: {
  raised: number | string;
  target: number | string;
  cap: boolean;
  amount: number | string;
}): { ok: true } | { ok: false; remaining: number; error: string } {
  if (!opts.cap) return { ok: true };
  const remaining = money(Math.max(0, money(opts.target) - money(opts.raised)));
  const amount = money(opts.amount);
  if (remaining <= 0) return { ok: false, remaining: 0, error: "This need is fully funded and capped" };
  if (amount > remaining) {
    return { ok: false, remaining, error: `Only ${formatPledgeAmount(remaining)} left before the cap` };
  }
  return { ok: true };
}

export function parseSuggestedAmounts(
  raw: unknown,
  minPledge: number | string,
): { ok: true; amounts: number[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, amounts: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Suggested amounts must be a list of numbers" };
  if (raw.length > 8) return { ok: false, error: "At most 8 suggested amounts" };
  const min = money(minPledge);
  const amounts: number[] = [];
  for (const v of raw) {
    const n = money(Number(v));
    if (!(n > 0)) return { ok: false, error: "Suggested amounts must be positive" };
    if (n < min) return { ok: false, error: "Each suggested amount must be at least the minimum pledge" };
    amounts.push(n);
  }
  return { ok: true, amounts };
}

/** Room total shared by the guest card, the host, the big screen and (after close) the invoices. */
export function roomTotals(auctionRaised: number | string, pledgeAmounts: Array<number | string>) {
  const auction = money(auctionRaised);
  const donations = money(pledgeAmounts.reduce<number>((s, n) => s + money(n), 0));
  return { auction, donations, total: money(auction + donations) };
}

export function sumMoney(amounts: Array<number | string>): number {
  return money(amounts.reduce<number>((s, n) => s + money(n), 0));
}
