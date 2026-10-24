import { statusAt, type EventStatus } from "./bidLogic";
import { formatTimeInZone } from "./time";

export type AuctionPhase = "scheduled" | "open" | "last15" | "last5" | "final" | "closed";

export type AuctionClock = {
  phase: AuctionPhase;
  /** Milliseconds until the auction end (or the start, while scheduled). Never negative. */
  remainingMs: number;
  /** HH:MM:SS. Empty once bidding is closed. */
  digits: string;
  /** Whole seconds left, for the final-minute takeover. */
  seconds: number;
  headline: string;
  /** Gold pulse: under 15 minutes, including the last 5 and the last minute. */
  pulse: boolean;
  /** Larger digits: under 5 minutes. */
  bigger: boolean;
  /** The main area becomes the seconds, under 60 seconds. */
  takeover: boolean;
  closedEarly: boolean;
};

const LAST_15 = 15 * 60_000;
const LAST_5 = 5 * 60_000;
const LAST_MINUTE = 60_000;

export function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Urgency is strictly under each threshold: 15:00 is still calm, 5:00 is still
 * "Last 15 minutes", and 1:00 is still the larger last-5 clock. The next millisecond
 * steps into the hotter state. A host extend moves `endsAt` later and the phase
 * follows. Close-early is `status: "closed"` even when the old end is still ahead.
 */
export function auctionClock(input: {
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  now: number;
  closedEarly?: boolean;
}): AuctionClock {
  const effective = statusAt(
    { status: input.status, startsAt: input.startsAt, endsAt: input.endsAt },
    input.now,
  );
  if (effective === "closed") {
    return {
      phase: "closed",
      remainingMs: 0,
      digits: "",
      seconds: 0,
      headline: "Bidding closed",
      pulse: false,
      bigger: false,
      takeover: false,
      closedEarly: Boolean(input.closedEarly),
    };
  }
  const target = Date.parse(effective === "scheduled" ? input.startsAt : input.endsAt);
  const remainingMs = Math.max(0, target - input.now);
  const digits = formatHms(remainingMs);
  const seconds = Math.floor(remainingMs / 1000) % 60;
  // The takeover and the pinned HH:MM:SS must name the same second. Ceil, so
  // 42.3s left reads 43 in both places, and the last instant still reads 1.
  if (effective === "scheduled") {
    return {
      phase: "scheduled",
      remainingMs,
      digits,
      seconds,
      headline: "Auction starts in",
      pulse: false,
      bigger: false,
      takeover: false,
      closedEarly: false,
    };
  }
  let phase: AuctionPhase = "open";
  if (remainingMs < LAST_MINUTE) phase = "final";
  else if (remainingMs < LAST_5) phase = "last5";
  else if (remainingMs < LAST_15) phase = "last15";
  const headline =
    phase === "final" ? "Final seconds" : phase === "last5" ? "Last 5 minutes" : phase === "last15" ? "Last 15 minutes" : "Auction ends in";
  const shownSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return {
    phase,
    remainingMs,
    digits: phase === "final" ? formatHms(shownSeconds * 1000) : digits,
    seconds: phase === "final" ? shownSeconds : seconds,
    headline,
    pulse: phase === "last15" || phase === "last5" || phase === "final",
    bigger: phase === "last5" || phase === "final",
    takeover: phase === "final",
    closedEarly: false,
  };
}

export type DonationEnd = { kind: "closed" } | { kind: "until"; time: string };

/**
 * Fund-a-Need's own end, only when it is a different instant from the auction.
 * Null when donations simply stay open, or when they close with the auction.
 * The English sentence stays in donationEndLine; the screen translates these parts.
 */
export function donationEndParts(opts: {
  needsEndsAt?: string | null;
  auctionEndsAt: string;
  timezone: string;
  now: number;
}): DonationEnd | null {
  if (!opts.needsEndsAt) return null;
  const need = Date.parse(opts.needsEndsAt);
  const auction = Date.parse(opts.auctionEndsAt);
  if (!Number.isFinite(need) || !Number.isFinite(auction)) return null;
  if (Math.abs(need - auction) < 1000) return null;
  if (opts.now >= need) return { kind: "closed" };
  return { kind: "until", time: formatTimeInZone(opts.needsEndsAt, opts.timezone) };
}

export function donationEndLine(opts: {
  needsEndsAt?: string | null;
  auctionEndsAt: string;
  timezone: string;
  now: number;
}): string | null {
  const parts = donationEndParts(opts);
  if (!parts) return null;
  if (parts.kind === "closed") return "Donations closed";
  return `Donations open until ${parts.time}`;
}
