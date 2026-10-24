import { describe, expect, it } from "vitest";
import { auctionClock, donationEndLine, formatHms } from "../src/lib/auctionClock";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const start = "2026-10-24T10:00:00.000Z";
const at = (ms: number) => new Date(now + ms).toISOString();

describe("auction countdown urgency", () => {
  it("formats HH:MM:SS and steps under 15 min, 5 min and 60 seconds", () => {
    expect(formatHms(3_661_000)).toBe("01:01:01");
    expect(formatHms(0)).toBe("00:00:00");
    const open = auctionClock({ status: "open", startsAt: start, endsAt: at(15 * 60_000), now });
    expect(open).toMatchObject({ phase: "open", digits: "00:15:00", pulse: false, bigger: false, takeover: false, headline: "Auction ends in" });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(15 * 60_000 - 1), now }).phase).toBe("last15");
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(5 * 60_000), now })).toMatchObject({ phase: "last15", pulse: true, bigger: false, headline: "Last 15 minutes" });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(5 * 60_000 - 1), now })).toMatchObject({ phase: "last5", bigger: true, takeover: false, headline: "Last 5 minutes" });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(60_000), now }).phase).toBe("last5");
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(60_000 - 1), now })).toMatchObject({
      phase: "final",
      bigger: true,
      takeover: true,
      pulse: true,
      headline: "Final seconds",
      seconds: 60,
      digits: "00:01:00",
    });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(45_000), now })).toMatchObject({ seconds: 45, digits: "00:00:45" });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: at(42_300), now })).toMatchObject({
      phase: "final",
      seconds: 43,
      digits: "00:00:43",
    });
    expect(auctionClock({ status: "open", startsAt: start, endsAt: new Date(now).toISOString(), now })).toMatchObject({
      phase: "closed",
      headline: "Bidding closed",
      takeover: false,
    });
  });

  it("follows an extend and an early close from the server end", () => {
    const ending = auctionClock({ status: "open", startsAt: start, endsAt: at(4 * 60_000), now });
    expect(ending.phase).toBe("last5");
    const extended = auctionClock({ status: "open", startsAt: start, endsAt: at(4 * 60_000 + 15 * 60_000), now });
    expect(extended.phase).toBe("open");
    expect(extended.remainingMs - ending.remainingMs).toBe(15 * 60_000);
    expect(extended.digits).toBe("00:19:00");
    expect(auctionClock({ status: "closed", startsAt: start, endsAt: at(30 * 60_000), now, closedEarly: true })).toMatchObject({
      phase: "closed",
      headline: "Bidding closed",
      takeover: false,
      pulse: false,
      closedEarly: true,
      remainingMs: 0,
    });
  });

  it("keeps a Fund-a-Need end as a separate line", () => {
    const auction = "2026-10-24T14:00:00.000Z";
    expect(donationEndLine({ needsEndsAt: null, auctionEndsAt: auction, timezone: "Asia/Bangkok", now })).toBeNull();
    expect(donationEndLine({ needsEndsAt: auction, auctionEndsAt: auction, timezone: "Asia/Bangkok", now })).toBeNull();
    expect(donationEndLine({
      needsEndsAt: "2026-10-24T15:30:00.000Z",
      auctionEndsAt: auction,
      timezone: "Asia/Bangkok",
      now,
    })).toBe("Donations open until 22:30");
    expect(donationEndLine({
      needsEndsAt: "2026-10-24T11:00:00.000Z",
      auctionEndsAt: auction,
      timezone: "Asia/Bangkok",
      now,
    })).toBe("Donations closed");
  });
});
