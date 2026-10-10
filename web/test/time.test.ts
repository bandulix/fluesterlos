import { afterEach, describe, expect, it } from "vitest";
import {
  defaultSchedule,
  formatTimeInZone,
  instantToWallTime,
  offsetLabel,
  wallTimeToInstant,
  wallTimeToIso,
} from "../src/lib/time";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// The click-test bug: a host browser that is NOT on Bangkok time created an event that was closed
// at birth. Every result below must be the same whatever zone the browser (here: Node) runs in.
const BROWSER_ZONES = ["UTC", "America/New_York", "Europe/Berlin", "Asia/Bangkok", "Pacific/Auckland"];

describe("event time zone helpers", () => {
  for (const browserTz of BROWSER_ZONES) {
    it(`converts event wall time to an absolute instant (browser in ${browserTz})`, () => {
      process.env.TZ = browserTz;
      expect(wallTimeToIso("2027-01-17T19:00", "Asia/Bangkok")).toBe("2027-01-17T19:00:00+07:00");
      expect(wallTimeToInstant("2027-01-17T19:00", "Asia/Bangkok")!.toISOString()).toBe("2027-01-17T12:00:00.000Z");
      expect(instantToWallTime("2027-01-17T12:00:00.000Z", "Asia/Bangkok")).toBe("2027-01-17T19:00");
      expect(formatTimeInZone("2027-01-17T12:00:00.000Z", "Asia/Bangkok")).toBe("19:00");
      expect(offsetLabel("Asia/Bangkok")).toBe("UTC+7");
    });

    it(`default schedule starts now (current minute) and runs 2 hours (browser in ${browserTz})`, () => {
      process.env.TZ = browserTz;
      const now = Date.parse("2026-10-10T09:02:30Z");
      const s = defaultSchedule("Asia/Bangkok", now);
      const start = wallTimeToInstant(s.startsAt, "Asia/Bangkok")!.getTime();
      const end = wallTimeToInstant(s.endsAt, "Asia/Bangkok")!.getTime();
      expect(start).toBeLessThanOrEqual(now);
      expect(now - start).toBeLessThan(60_000);
      expect(end - start).toBe(2 * 3_600_000);
      expect(s.startsAt).toBe("2026-10-10T16:02");
      expect(s.endsAt).toBe("2026-10-10T18:02");
    });
  }

  it("handles zones with DST and half-hour offsets", () => {
    expect(wallTimeToIso("2027-07-01T20:00", "Europe/Berlin")).toBe("2027-07-01T20:00:00+02:00");
    expect(wallTimeToIso("2027-01-01T20:00", "Europe/Berlin")).toBe("2027-01-01T20:00:00+01:00");
    expect(wallTimeToIso("2027-01-01T20:00", "America/New_York")).toBe("2027-01-01T20:00:00-05:00");
    expect(offsetLabel("Asia/Kolkata")).toBe("UTC+5:30");
    expect(offsetLabel("UTC")).toBe("UTC");
  });

  it("round-trips instants through the event zone", () => {
    for (const tz of ["Asia/Bangkok", "America/New_York", "Australia/Sydney"]) {
      const wall = instantToWallTime("2027-03-05T10:15:00Z", tz);
      expect(wallTimeToInstant(wall, tz)!.toISOString()).toBe("2027-03-05T10:15:00.000Z");
    }
  });

  it("rejects malformed input", () => {
    expect(wallTimeToIso("17/01/2027 19:00", "Asia/Bangkok")).toBeNull();
  });
});
