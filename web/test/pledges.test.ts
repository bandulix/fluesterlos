import { describe, expect, it } from "vitest";
import { anonymousGiftLabel, bigScreenFrame, pledgeTotal, pledgedNeedIds, raisedSplit, recognitionMoves, stepUnits, unitsCost } from "../src/lib/pledgeLogic";

describe("raised split", () => {
  it("adds auction high bids and donations, and trusts a server total", () => {
    expect(raisedSplit({ totalHighBids: 7200 })).toEqual({ auction: 7200, donations: 0, total: 7200 });
    expect(raisedSplit({ totalHighBids: 7200, totalDonations: 2400 })).toEqual({ auction: 7200, donations: 2400, total: 9600 });
    expect(raisedSplit({ totalHighBids: 1000.1, totalDonations: 0.2, totalRaised: 1000.3 })).toEqual({
      auction: 1000.1,
      donations: 0.2,
      total: 1000.3,
    });
  });

  it("rounds half-cents the same way the invoice does", () => {
    expect(raisedSplit({ totalHighBids: 10.005, totalDonations: 0.004 }).total).toBe(10.01);
  });
});

describe("guest pledges", () => {
  it("lists each need once and sums the guest's pledges", () => {
    const pledges = [
      { needId: "a", amount: 800 },
      { needId: "a", amount: 1600 },
      { needId: "b", amount: 5000 },
    ];
    expect(pledgedNeedIds(pledges)).toEqual(["a", "b"]);
    expect(pledgedNeedIds(undefined)).toEqual([]);
    expect(pledgeTotal(pledges)).toBe(7400);
    expect(pledgeTotal(undefined)).toBe(0);
  });
});

describe("unit stepper", () => {
  it("steps by one, never below 1, and prices whole units", () => {
    expect(stepUnits(1, -1)).toBe(1);
    expect(stepUnits(3, 1)).toBe(4);
    expect(stepUnits(999, 1)).toBe(999);
    expect(stepUnits(Number.NaN, 1)).toBe(2);
    expect(unitsCost(3, 800)).toBe(2400);
    expect(unitsCost(1, 10.005)).toBe(10.01);
  });
});

describe("big screen frame", () => {
  it("stays on the auction when there are no needs", () => {
    expect(bigScreenFrame(1, 0, false, false)).toBe("auction");
    expect(bigScreenFrame(1, 0, true, true)).toBe("auction");
  });

  it("alternates, and a spotlight or a fresh pledge holds Fund-a-Need", () => {
    expect(bigScreenFrame(0, 3, false, false)).toBe("auction");
    expect(bigScreenFrame(1, 3, false, false)).toBe("needs");
    expect(bigScreenFrame(2, 3, false, false)).toBe("auction");
    expect(bigScreenFrame(0, 3, true, false)).toBe("needs");
    expect(bigScreenFrame(0, 3, false, true)).toBe("needs");
  });

  it("rotates Top Donors, and a spotlight holds that frame", () => {
    expect(bigScreenFrame(0, 3, false, false, true)).toBe("auction");
    expect(bigScreenFrame(1, 3, false, false, true)).toBe("needs");
    expect(bigScreenFrame(2, 3, false, false, true)).toBe("donors");
    expect(bigScreenFrame(3, 3, false, false, true)).toBe("auction");
    expect(bigScreenFrame(1, 3, true, false, true, false)).toBe("needs");
    expect(bigScreenFrame(1, 3, true, false, true, true)).toBe("donors");
    expect(bigScreenFrame(0, 0, false, false, true, true)).toBe("donors");
  });
});

describe("donor recognition display", () => {
  it("counts anonymous gifts and celebrates a move into the top 3", () => {
    expect(anonymousGiftLabel(0)).toBe("");
    expect(anonymousGiftLabel(1)).toBe("+ 1 anonymous gift");
    expect(anonymousGiftLabel(4)).toBe("+ 4 anonymous gifts");
    const before = [
      { name: "A", rank: 1 },
      { name: "B", rank: 2 },
      { name: "C", rank: 4 },
    ];
    expect(recognitionMoves(before, [
      { name: "C", rank: 2 },
      { name: "A", rank: 1 },
      { name: "D", rank: 3 },
    ])).toEqual(["C", "D"]);
    expect(recognitionMoves(before, before)).toEqual([]);
  });
});
