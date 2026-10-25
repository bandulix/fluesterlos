import { describe, expect, it } from "vitest";
import { filterCounts, filterItems } from "../src/lib/bidLogic";
import {
  FINAL_MS,
  customBidAmount,
  hostNextActions,
  otpBackspace,
  otpType,
  otpValue,
  paddleTiles,
  relativeAgo,
  ringState,
} from "../src/lib/p2";

const blank = ["", "", "", "", "", ""];

describe("join code boxes", () => {
  it("advances one digit and keeps a pasted code", () => {
    const typed = otpType(blank, 0, "4");
    expect(typed.slots[0]).toBe("4");
    expect(typed.focus).toBe(1);
    const pasted = otpType(blank, 2, "123456");
    expect(otpValue(pasted.slots)).toBe("123456");
    expect(pasted.focus).toBe(5);
    const mid = otpType(["1", "2", "", "", "", ""], 2, "89");
    expect(otpValue(mid.slots)).toBe("1289");
  });

  it("clears the current box, then steps back", () => {
    const filled = otpBackspace(["1", "2", "", "", "", ""], 1);
    expect(filled.slots[1]).toBe("");
    expect(filled.focus).toBe(1);
    const empty = otpBackspace(filled.slots, 1);
    expect(empty.slots[0]).toBe("");
    expect(empty.focus).toBe(0);
  });
});

describe("countdown ring", () => {
  it("stays quiet until the last five minutes", () => {
    expect(ringState(60 * 60 * 1000, 2 * 60 * 60 * 1000)).toEqual({ fraction: 0.5, urgent: false });
    expect(ringState(FINAL_MS, 60 * 60 * 1000).urgent).toBe(true);
    expect(ringState(FINAL_MS + 1, 60 * 60 * 1000).urgent).toBe(false);
    expect(ringState(0, 1000)).toEqual({ fraction: 0, urgent: false });
    expect(ringState(-5, 0).fraction).toBe(0);
  });
});

describe("custom bid and paddle tiles", () => {
  it("accepts an amount at the next minimum", () => {
    expect(customBidAmount("", 500).ok).toBe(false);
    expect(customBidAmount("499", 500).ok).toBe(false);
    expect(customBidAmount("1,200", 500)).toEqual({ ok: true, amount: 1200 });
    expect(customBidAmount("500.5", 500)).toEqual({ ok: true, amount: 500.5 });
  });

  it("offers the called level and its neighbours", () => {
    const levels = [20000, 10000, 5000, 2000];
    expect(paddleTiles(levels, 0)).toEqual([20000, 10000]);
    expect(paddleTiles(levels, 1)).toEqual([20000, 10000, 5000]);
    expect(paddleTiles(levels, 3)).toEqual([5000, 2000]);
  });
});

describe("host next actions", () => {
  it("offers start, then the next level, and close while the night is open", () => {
    expect(hostNextActions({ status: "open", paddle: "off", openLots: 2 })).toEqual({
      paddle: "start",
      closeLot: true,
      closeAuction: true,
    });
    expect(hostNextActions({ status: "open", paddle: "live", openLots: 1 }).paddle).toBe("next");
    expect(hostNextActions({ status: "open", paddle: "paused", openLots: 0 })).toEqual({
      paddle: "next",
      closeLot: false,
      closeAuction: true,
    });
    expect(hostNextActions({ status: "closed", paddle: "live", openLots: 3 })).toEqual({
      paddle: "none",
      closeLot: false,
      closeAuction: false,
    });
    expect(hostNextActions({ status: "open", paddle: "ended", openLots: 2 }).paddle).toBe("start");
  });
});

describe("relative time", () => {
  it("stays on just now, then minutes, hours and days", () => {
    expect(relativeAgo(10).key).toBe("time.justNow");
    expect(relativeAgo(59).key).toBe("time.justNow");
    expect(relativeAgo(60)).toEqual({ key: "time.minutesAgo", n: 1 });
    expect(relativeAgo(90)).toEqual({ key: "time.minutesAgo", n: 1 });
    expect(relativeAgo(3600)).toEqual({ key: "time.hoursAgo", n: 1 });
    expect(relativeAgo(90000)).toEqual({ key: "time.daysAgo", n: 1 });
  });
});

describe("watching filter", () => {
  const items = [
    { id: "a", leaderKey: "me" },
    { id: "b", leaderKey: "other" },
  ];
  const me = { guest: null, leaderKey: "me", bidItemIds: ["a", "b"] };

  it("keeps only lots this guest is watching", () => {
    expect(filterItems(items, "watching", me, ["b"]).map((it) => it.id)).toEqual(["b"]);
    expect(filterCounts(items, me, ["a", "b"]).watching).toBe(2);
  });
});
