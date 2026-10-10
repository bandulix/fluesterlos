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
