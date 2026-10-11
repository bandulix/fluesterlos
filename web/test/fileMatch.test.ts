import { describe, expect, it } from "vitest";
import { baseTitle, fileKind, matchFile, withLots } from "../src/lib/fileMatch";

const items = withLots([
  { id: "a", title: "Large Gift Box of Premium Chocolate", kind: "physical" as const },
  { id: "b", title: "Spa Day for Two", kind: "voucher" as const },
  { id: "c", title: "Sunday Brunch (1/3)", kind: "voucher" as const },
  { id: "d", title: "Sunday Brunch (2/3)", kind: "voucher" as const },
  { id: "e", title: "Sunday Brunch (3/3)", kind: "voucher" as const },
  { id: "f", title: "Voucher for one Bay", kind: "voucher" as const },
  { id: "g", title: "Voucher for one Bay", kind: "voucher" as const },
  { id: "h", title: "2 Nights for Two in a Garden Room", kind: "voucher" as const },
]);

describe("bulk upload file matching", () => {
  it("file types", () => {
    expect(fileKind("a.JPG")).toBe("photo");
    expect(fileKind("x", "image/png")).toBe("photo");
    expect(fileKind("v.pdf")).toBe("voucher");
    expect(fileKind("notes.docx")).toBe(null);
    expect(matchFile("notes.docx", items).itemIds).toEqual([]);
  });

  it("lot number prefix: 03-spa.jpg, Lot 2.pdf, #8.png", () => {
    expect(matchFile("02-spa.jpg", items)).toMatchObject({ itemIds: ["b"], how: "lot" });
    expect(matchFile("Lot 2.pdf", items)).toMatchObject({ itemIds: ["b"], how: "lot" });
    expect(matchFile("#8.png", items)).toMatchObject({ itemIds: ["h"], how: "lot" });
    expect(matchFile("3_brunch.pdf", items)).toMatchObject({ itemIds: ["c"], how: "lot" });
  });

  it("title: exact, case/punctuation-insensitive, or most words", () => {
    expect(matchFile("Spa Day for Two.pdf", items)).toMatchObject({ itemIds: ["b"], how: "title" });
    expect(matchFile("spa-day.pdf", items)).toMatchObject({ itemIds: ["b"], how: "title" });
    expect(matchFile("chocolate box.jpg", items)).toMatchObject({ itemIds: ["a"], how: "title" });
    // A title starting with a number is not mistaken for a lot number.
    expect(matchFile("2 Nights for Two in a Garden Room.jpg", items)).toMatchObject({ itemIds: ["h"], how: "title" });
    expect(matchFile("2 nights garden room.jpg", items)).toMatchObject({ itemIds: ["h"], how: "title" });
  });

  it("a photo goes to every unit of a multi-unit lot and to same-titled items", () => {
    expect(matchFile("Sunday Brunch.jpg", items).itemIds).toEqual(["c", "d", "e"]);
    expect(matchFile("bay.jpg", items).itemIds).toEqual(["f", "g"]);
  });

  it("a voucher PDF goes to one item only; ambiguous or physical → host picks", () => {
    expect(matchFile("Sunday Brunch.pdf", items)).toMatchObject({ itemIds: [], how: null });
    expect(matchFile("Sunday Brunch.pdf", items).note).toMatch(/pick one/);
    expect(matchFile("01-chocolate.pdf", items).note).toMatch(/physical/);
    expect(matchFile("random holiday.pdf", items)).toMatchObject({ itemIds: [], note: "No matching item — pick one" });
  });

  it("baseTitle drops the unit suffix", () => {
    expect(baseTitle("Brunch (10/10)")).toBe("Brunch");
    expect(baseTitle("Brunch (for two)")).toBe("Brunch (for two)");
  });
});
