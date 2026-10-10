/** Event time zones: times are stored as UTC (timestamptz); the zone is only for display/input. */
export const FALLBACK_EVENT_TIMEZONE = "Asia/Bangkok";

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function defaultEventTimeZone(): string {
  const env = (process.env.DEFAULT_EVENT_TIMEZONE ?? "").trim();
  return env && isValidTimeZone(env) ? env : FALLBACK_EVENT_TIMEZONE;
}

/**
 * Accept only absolute instants: ISO 8601 with "Z" or an explicit offset.
 * A bare "2027-01-17T19:00" would be read in the server's (or Postgres session's) zone,
 * which is exactly the bug this guards against.
 */
export function parseInstant(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim())) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function wallTimeParts(at: Date, tz: string) {
  const out: Record<string, number> = {};
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const p of f.formatToParts(at)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

/** "UTC+7", "UTC+5:30", "UTC-5", "UTC" for `tz` at instant `at`. */
export function offsetLabel(tz: string, at: Date = new Date()): string {
  const whole = new Date(Math.floor(at.getTime() / 1000) * 1000);
  const p = wallTimeParts(whole, tz);
  const min = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole.getTime()) / 60_000);
  if (min === 0) return "UTC";
  const abs = Math.abs(min);
  return `UTC${min < 0 ? "-" : "+"}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}
