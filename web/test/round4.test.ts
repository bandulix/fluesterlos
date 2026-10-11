import { describe, expect, it } from "vitest";
import { chunk, gridFit, hotItemIds, pageCount, pageSlice } from "../src/lib/bigScreen";
import { hostPriceLine } from "../src/lib/hostText";
import { bulkFooter, targetsFor, withLots } from "../src/lib/fileMatch";
import { dedupeDescription } from "../src/lib/text";
import { isFixedPrice } from "../src/lib/bidLogic";
import { parseCurrency } from "../src/lib/money";

describe("big screen paging", () => {
  it("fits 8–12 cards on a TV and never 0", () => {
    // 1920x1080 board area ≈ 1250x470 → 5 cols × 3 rows fit; capped at 12 by dropping a column
    expect(gridFit(1250, 470, 240, 84, 10)).toEqual({ cols: 4, rows: 3, perPage: 12 });
    // 1280x720 board area ≈ 820x290 → 3 cols × 3 rows = 9
    expect(gridFit(820, 290, 240, 84, 10)).toEqual({ cols: 3, rows: 3, perPage: 9 });
    expect(gridFit(0, 0, 240, 84, 10).perPage).toBe(1);
    // A huge wall never shows more than 12.
    expect(gridFit(4000, 3000, 240, 84, 10).perPage).toBe(12);
  });

  it("pages through all 48 items", () => {
    const items = Array.from({ length: 48 }, (_, i) => i + 1);
    expect(pageCount(48, 12)).toBe(4);
    expect(pageCount(48, 9)).toBe(6);
    expect(pageSlice(items, 5, 9)).toEqual([46, 47, 48]);
    expect(pageSlice(items, 6, 9)).toEqual(items.slice(0, 9)); // wraps
    const seen = Array.from({ length: pageCount(48, 9) }, (_, p) => pageSlice(items, p, 9)).flat();
    expect(seen).toEqual(items);
    expect(pageCount(0, 12)).toBe(1);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("hot items: recent bids weigh most, unbid and sold lots never hot", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const ago = (min: number) => new Date(now - min * 60_000).toISOString();
    const items = [
      { id: "a", bidCount: 6 },
      { id: "b", bidCount: 2 },
      { id: "c", bidCount: 0 },
      { id: "d", bidCount: 1, soldViaBuyNow: true },
      { id: "e", bidCount: 1 },
    ];
    const recent = [
      { itemId: "b", createdAt: ago(1) },
      { itemId: "b", createdAt: ago(2) },
      { itemId: "e", createdAt: ago(30) },
      { itemId: "d", createdAt: ago(1) },
    ];
    expect(hotItemIds(items, recent, now)).toEqual(["b", "a", "e"]);
    expect(hotItemIds(items, recent, now, 1)).toEqual(["b"]);
    expect(hotItemIds([{ id: "x", bidCount: 0 }], [], now)).toEqual([]);
  });
});

describe("host item list price line", () => {
  const thb = parseCurrency("THB");
  it("says 'Starting … · no bids' instead of 'high … · 0 bids'", () => {
    expect(hostPriceLine({ soldViaBuyNow: false, highBid: 2000, buyNow: null, startingBid: 2000, bidCount: 0 }, thb)).toBe("Starting ฿2,000 · no bids");
    expect(hostPriceLine({ soldViaBuyNow: false, highBid: 2400, buyNow: null, startingBid: 2000, bidCount: 3 }, thb)).toBe("High ฿2,400 · 3 bids");
    expect(hostPriceLine({ soldViaBuyNow: false, highBid: 3000, buyNow: 3000, startingBid: 3000, bidCount: 0 }, thb)).toBe("Fixed price ฿3,000 · not sold yet");
    expect(hostPriceLine({ soldViaBuyNow: true, highBid: 3000, buyNow: 3000, startingBid: 3000, bidCount: 1 }, thb)).toBe("Sold ฿3,000");
    expect(hostPriceLine({ soldViaBuyNow: true, highBid: 5000, buyNow: 5000, startingBid: 2000, bidCount: 2 }, thb)).toBe("Sold ฿5,000 (buy now)");
  });

  it("fixed price = buy-now equals the starting bid", () => {
    expect(isFixedPrice({ buyNow: 3000, startingBid: 3000 })).toBe(true);
    expect(isFixedPrice({ buyNow: 5000, startingBid: 3000 })).toBe(false);
    expect(isFixedPrice({ buyNow: null, startingBid: 3000 })).toBe(false);
  });
});

describe("bulk media", () => {
  const lots = withLots([
    { id: "a", title: "Chocolate box", kind: "physical" as const },
    { id: "b", title: "Spa day", kind: "voucher" as const },
    { id: "c", title: "Brunch", kind: "voucher" as const },
  ]);
  it("a PDF can only go to voucher items; a photo to any item", () => {
    expect(targetsFor("voucher", lots).map((l) => l.id)).toEqual(["b", "c"]);
    expect(targetsFor("photo", lots).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(targetsFor(null, lots)).toEqual([]);
  });
  it("footer: '8 files uploaded ✓' after a successful upload, not '0 of 8 matched'", () => {
    const done = Array.from({ length: 8 }, () => ({ status: "done" as const, itemIds: ["x"] }));
    expect(bulkFooter(done)).toBe("✓ 8 files uploaded");
    expect(bulkFooter([...done.slice(0, 7), { status: "done", itemIds: ["x", "y", "z"] }])).toBe("✓ 8 files uploaded (10 items)");
    expect(bulkFooter([{ status: "done", itemIds: ["x"] }, { itemIds: [] }, { itemIds: ["y"] }])).toBe(
      "✓ 1 file uploaded · 1 more ready to upload · 1 not uploaded (no item chosen)",
    );
    expect(bulkFooter([{ status: "error", itemIds: ["x"] }])).toMatch(/1 failed/);
    expect(bulkFooter([{ itemIds: ["x"] }, { itemIds: [] }])).toBe("1 of 2 files matched — check the “Goes to” column");
  });
});

describe("guest description dedupe", () => {
  it("drops a repeated title from the start of the description", () => {
    expect(dedupeDescription("Spa Day for Two", "SPA DAY FOR TWO\nFull day incl. lunch")).toBe("Full day incl. lunch");
    expect(dedupeDescription("Café Voucher", "Cafe voucher – two coffees")).toBe("two coffees");
    expect(dedupeDescription("Spa", "Spacious room")).toBe("Spacious room");
    expect(dedupeDescription("Brunch", "")).toBe("");
  });
});
