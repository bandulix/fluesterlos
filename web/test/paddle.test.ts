import { describe, expect, it } from "vitest";
import { countUpAt, freshPops, paddleHit, paddleProgress, roomMain } from "../src/lib/paddleLogic";

describe("paddle raise on the big screen", () => {
  it("keeps the countdown bar and lets a live paddle own the main area", () => {
    expect(roomMain({ countdownTakeover: true, paddleStatus: "live" })).toBe("paddle");
    expect(roomMain({ countdownTakeover: true, paddleStatus: "paused" })).toBe("paddle");
    expect(roomMain({ countdownTakeover: true, paddleStatus: "ended" })).toBe("countdown");
    expect(roomMain({ countdownTakeover: false, paddleStatus: "off" })).toBe("room");
  });

  it("fills the goal bar and notices a new gift", () => {
    expect(paddleProgress(7500, 10000)).toBe(75);
    expect(paddleProgress(12000, 10000)).toBe(100);
    expect(paddleHit(9999, 10000)).toBe(false);
    expect(paddleHit(10000, 10000)).toBe(true);
    expect(freshPops(["a"], ["b", "a"])).toEqual(["b"]);
  });

  it("lands the running total on the real amount", () => {
    expect(countUpAt(0, 60000, 0)).toBe(0);
    expect(countUpAt(0, 60000, 350)).toBeGreaterThan(40000);
    expect(countUpAt(0, 60000, 350)).toBeLessThan(60000);
    expect(countUpAt(0, 60000, 700)).toBe(60000);
    expect(countUpAt(59985, 60000, 5000)).toBe(60000);
  });
});