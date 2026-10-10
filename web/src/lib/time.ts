/**
 * Event time zone helpers. Times are stored as UTC instants; each event has an IANA zone
 * (default Asia/Bangkok) used for the datetime-local inputs and every time shown in the UI,
 * so the host's and guests' browser zones never change what "19:00" means.
 * Nothing here depends on the browser's own zone.
 */
export const DEFAULT_EVENT_TZ = "Asia/Bangkok";

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function partsInZone(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at instant `ms`, in minutes (Bangkok = +420). */
export function zoneOffsetMinutes(ms: number, tz: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = partsInZone(whole, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - whole) / 60_000);
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2027-01-17T19:00" read as wall time in `tz` → UTC instant. */
export function wallTimeToInstant(local: string, tz: string): Date | null {
  const m = WALL_RE.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off1 = zoneOffsetMinutes(guess, tz);
  let t = guess - off1 * 60_000;
  const off2 = zoneOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60_000; // DST edge
  return new Date(t);
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** "2027-01-17T19:00" in Asia/Bangkok → "2027-01-17T19:00:00+07:00" (what the API expects). */
export function wallTimeToIso(local: string, tz: string): string | null {
  const d = wallTimeToInstant(local, tz);
  if (!d) return null;
  return `${local}:00${offsetSuffix(zoneOffsetMinutes(d.getTime(), tz))}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC instant → "YYYY-MM-DDTHH:mm" wall time in `tz` (value for a datetime-local input). */
export function instantToWallTime(at: string | number | Date, tz: string): string {
  const p = partsInZone(new Date(at).getTime(), tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** "UTC+7", "UTC+5:30", "UTC-5", "UTC". */
export function offsetLabel(tz: string, at: number | Date = Date.now()): string {
  const min = zoneOffsetMinutes(new Date(at).getTime(), tz);
  if (min === 0) return "UTC";
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
}

/** "Sun 17 Jan, 19:00" in the event zone. */
export function formatInZone(at: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

/** "19:05" in the event zone. */
export function formatTimeInZone(at: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(at),
  );
}

/** Default schedule for the create form: starts at the next 5-minute mark ≥ 5 min away, runs 2 h. */
export function defaultSchedule(tz: string, now = Date.now()) {
  const start = Math.ceil((now + 5 * 60_000) / (5 * 60_000)) * 5 * 60_000;
  return { startsAt: instantToWallTime(start, tz), endsAt: instantToWallTime(start + 2 * 3_600_000, tz) };
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timeZoneChoices(extra: string[] = []): string[] {
  const list = [
    DEFAULT_EVENT_TZ,
    ...extra,
    browserTimeZone(),
    "UTC",
    "Europe/Berlin",
    "Europe/London",
    "America/New_York",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  return [...new Set(list.filter((z) => z && isValidTimeZone(z)))];
}
