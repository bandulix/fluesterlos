import { describe, expect, it } from "vitest";
import { bigScreenFrame } from "../src/lib/pledgeLogic";
import { projectProgress, tradeProgress } from "../src/lib/projectLogic";

describe("project progress", () => {
  it("caps a trade at its placeholder target and sums the building", () => {
    expect(tradeProgress(1000, 250)).toMatchObject({ remaining: 750, percent: 25, funded: false });
    expect(tradeProgress(1000, 1000).funded).toBe(true);
    expect(tradeProgress(1000, 1400)).toMatchObject({ remaining: 0, percent: 100, funded: true });
    expect(projectProgress([
      { target: 450000, raised: 450000 },
      { target: 180000, raised: 0 },
    ])).toMatchObject({ target: 630000, raised: 450000, remaining: 180000 });
  });
});

describe("projector project frame", () => {
  it("rotates project funding in with the auction", () => {
    expect(bigScreenFrame(0, 0, false, false, false, false, 1)).toBe("auction");
    expect(bigScreenFrame(1, 0, false, false, false, false, 1)).toBe("projects");
    expect(bigScreenFrame(3, 2, false, false, true, false, 1)).toBe("projects");
  });
});
