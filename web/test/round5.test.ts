import { describe, expect, it } from "vitest";
import { gridFit, spotlightAt, spotlightText, topLot } from "../src/lib/bigScreen";
import { dedupeDescription, tidyDescription } from "../src/lib/text";

describe("big screen: cards fill the board height", () => {
  it("stretches rows to the available height (1024×594 left a third empty before)", () => {
    // ~680×250 board on a 1024×594 display, 200px min width, 66px min height
    const f = gridFit(680, 250, 200, 66, 10);
    expect(f).toMatchObject({ cols: 3, rows: 3, perPage: 9 });
    expect(f.cardH * f.rows + 10 * (f.rows - 1)).toBeGreaterThanOrEqual(245);
    // Capped at 12 per page: rows that remain grow (up to 132px) instead of leaving a gap.
    const big = gridFit(1250, 600, 240, 84, 10);
    expect(big.perPage).toBeLessThanOrEqual(12);
    expect(big.cardH * big.rows + 10 * (big.rows - 1)).toBeGreaterThanOrEqual(Math.min(600, 132 * big.rows) - 10);
    expect(gridFit(1250, 2000, 240, 84, 10).cardH).toBe(132);
    // Shorter than one minimum card: shrink the row so it stays inside the board.
    const tight = gridFit(400, 40, 240, 84, 10);
    expect(tight.rows).toBe(1);
    expect(tight.cardH).toBeLessThanOrEqual(40);
    expect(tight.cardH * tight.rows + 10 * (tight.rows - 1)).toBeLessThanOrEqual(40);
  });
});

describe("big screen spotlight", () => {
  const items = [
    { id: "a", bidCount: 0 },
    { id: "b", bidCount: 2 },
    { id: "c", bidCount: 0 },
    { id: "d", bidCount: 1 },
    { id: "e", bidCount: 1, soldViaBuyNow: true },
  ];
  const recent = [{ itemId: "d", createdAt: "" }, { itemId: "b", createdAt: "" }, { itemId: "d", createdAt: "" }];
  it("prefers items with recent bids, still gives unbid items every third slot", () => {
    const seq = Array.from({ length: 9 }, (_, i) => spotlightAt(i, items, recent)!.id);
    expect(seq).toEqual(["d", "b", "a", "d", "b", "c", "d", "b", "a"]);
  });
  it("cycles all items while nobody has bid", () => {
    const none = items.map((i) => ({ ...i, bidCount: 0, soldViaBuyNow: false }));
    expect([0, 1, 2].map((i) => spotlightAt(i, none, [])!.id)).toEqual(["a", "b", "c"]);
    expect(spotlightAt(0, [], [])).toBeUndefined();
  });
  it("sub-line reflects that item's own state", () => {
    const base = { highBid: 1000, startingBid: 1000, buyNow: null, highBidder: null };
    expect(spotlightText({ ...base, bidCount: 0 }, false)).toEqual({ label: "Starting bid", amount: 1000, sub: "No bids yet — be the first!" });
    expect(spotlightText({ ...base, bidCount: 3, highBid: 1500, highBidder: "Guest 4" }, false)).toEqual({ label: "Current bid", amount: 1500, sub: "Leading: Guest 4 · 3 bids" });
    expect(spotlightText({ ...base, bidCount: 1, highBidder: "Guest 4" }, true).sub).toBe("Won by Guest 4 · 1 bid");
    expect(spotlightText({ ...base, startingBid: 3000, buyNow: 3000, highBid: 3000, bidCount: 0 }, false)).toMatchObject({ label: "Fixed price", amount: 3000 });
    expect(spotlightText({ ...base, startingBid: 3000, buyNow: 3000, highBid: 3000, bidCount: 1, soldViaBuyNow: true, highBidder: "Guest 2" }, false)).toEqual({
      label: "Sold at fixed price", amount: 3000, sub: "Bought by Guest 2",
    });
  });
});

describe("closed top lot", () => {
  const lot = (id: string, highBid: number, bidCount: number, sortOrder: number, soldViaBuyNow = false) =>
    ({ id, highBid, bidCount, sortOrder, soldViaBuyNow });

  it("is the highest winning bid among sold lots, earliest on a tie", () => {
    const items = [
      lot("riverside", 2500, 2, 0),
      lot("chiang-mai", 9000, 2, 1),
      lot("football", 1700, 2, 2),
      lot("cooking", 3500, 2, 3),
      lot("spa", 3000, 2, 4),
      lot("wine", 4500, 2, 5),
      lot("print", 1000, 0, 6),
      lot("cruise", 6000, 0, 7),
    ];
    expect(topLot(items)?.id).toBe("chiang-mai");
    expect(topLot([lot("unsold", 20000, 0, 0), lot("sold", 100, 1, 1)])?.id).toBe("sold");
    expect(topLot([lot("later", 5000, 1, 4), lot("earlier", 5000, 1, 1)])?.id).toBe("earlier");
    expect(topLot([lot("bid", 4000, 2, 0), lot("buynow", 7000, 0, 2, true)])?.id).toBe("buynow");
    expect(topLot([lot("waiting", 9000, 0, 0)])).toBeUndefined();
    expect(topLot([])).toBeUndefined();
  });
});

describe("description tidy (stray quotes)", () => {
  it("drops a leftover quote and lines that are only punctuation", () => {
    expect(dedupeDescription('Chocolate Set "M&Ms and Skittles galore"', 'Chocolate Set "M&Ms and Skittles galore"')).toBe("");
    expect(dedupeDescription("Chocolate Set M&Ms and Skittles galore", '"')).toBe("");
    expect(tidyDescription('"\n—\n…')).toBe("");
    expect(tidyDescription('"Relax all day"\nValid weekdays')).toBe("Relax all day\nValid weekdays");
    expect(tidyDescription("„Wellness“ für zwei")).toBe("„Wellness“ für zwei");
    expect(tidyDescription('Line one"')).toBe("Line one");
    expect(tidyDescription('He said "hi" there')).toBe('He said "hi" there');
    expect(tidyDescription("1 Night (01MAR - 31JUL 2099)")).toBe("1 Night (01MAR - 31JUL 2099)");
  });
});
