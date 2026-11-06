import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "../src/i18n";
import { bigScreenFrame } from "../src/lib/pledgeLogic";
import { nextOpenTrade, pledgePresets, projectProgress, tradeProgress } from "../src/lib/projectLogic";
import { seedText } from "../src/lib/projectCopy";
import { buildingStage } from "../src/lib/buildingStage";

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

describe("demo school copy", () => {
  afterEach(() => setLanguage("en"));

  it("follows the guest language and leaves a host-typed name as entered", () => {
    setLanguage("en");
    expect(seedText("school", "title", "Schulgebäude")).toBe("School building");
    expect(seedText("roof", "description", "Roof structure and covering.")).toBe("Roof structure and covering.");
    setLanguage("de");
    expect(seedText("school", "title", "Schulgebäude")).toBe("Schulgebäude");
    expect(seedText("shell", "title", "Rohbau")).toBe("Rohbau");
    expect(seedText("furniture", "description", "x")).toContain("Tische");
    setLanguage("th");
    expect(seedText("school", "title", "Schulgebäude")).toBe("อาคารเรียน");
    expect(seedText("electrics", "title", "Elektro")).toBe("ระบบไฟฟ้า");
    expect(seedText(null, "title", "Custom hall")).toBe("Custom hall");
  });
});

describe("pledge path", () => {
  it("offers set amounts under the remainder and points at the trade closest to done", () => {
    expect(pledgePresets(250_000)).toEqual([1000, 5000, 10000, 25000]);
    expect(pledgePresets(8_000)).toEqual([1000, 5000]);
    expect(pledgePresets(500)).toEqual([]);
    const next = nextOpenTrade([
      { id: "shell", remaining: 800_000, percent: 0 },
      { id: "roof", remaining: 250_000, percent: 44.4 },
      { id: "furniture", remaining: 0, percent: 100 },
    ]);
    expect(next?.id).toBe("roof");
  });
});

describe("school building stages", () => {
  it("turns a trade from an outline into a finished part", () => {
    expect(buildingStage(0)).toBe("ghost");
    expect(buildingStage(18)).toBe("sketch");
    expect(buildingStage(44)).toBe("sketch");
    expect(buildingStage(60)).toBe("material");
    expect(buildingStage(100)).toBe("real");
  });
});

describe("projector project frame", () => {
  it("rotates project funding in with the auction", () => {
    expect(bigScreenFrame(0, 0, false, false, false, false, 1)).toBe("auction");
    expect(bigScreenFrame(1, 0, false, false, false, false, 1)).toBe("projects");
    expect(bigScreenFrame(3, 2, false, false, true, false, 1)).toBe("projects");
  });
});
