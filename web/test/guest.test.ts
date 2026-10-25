import { describe, expect, it } from "vitest";
import { formatPhoneInput, phoneLooksComplete } from "../src/lib/phoneInput";
import {
  canStepDown,
  canStepUp,
  clockOffset,
  effectiveAmount,
  CLOSED_FILTERS,
  filterCounts,
  filterItems,
  filtersFor,
  formatRemaining,
  itemStatus,
  minNextBid,
  newlyOutbid,
  onlyBuyNow,
  statusAt,
  statusMap,
  stepAmount,
  wonItems,
} from "../src/lib/bidLogic";
import { detectPlatform, shouldShowInstallHint } from "../src/lib/installHint";
import { formatAmount, formatMoney } from "../src/lib/money";
import { clearPendingJoin, loadPendingJoin, PENDING_JOIN_TTL_MS, savePendingJoin } from "../src/lib/pendingJoin";
import { listTitles } from "../src/lib/listTitles";
import { en } from "../src/i18n/en";
import { plural, t } from "../src/i18n";

describe("phone input auto-format (Thai default)", () => {
  it("formats Thai mobile and landline numbers as typed", () => {
    expect(formatPhoneInput("0812345678")).toBe("081 234 5678");
    expect(formatPhoneInput("081")).toBe("081");
    expect(formatPhoneInput("0812")).toBe("081 2");
    expect(formatPhoneInput("081-234-56789999")).toBe("081 234 5678");
    expect(formatPhoneInput("021234567")).toBe("02 123 4567");
    expect(formatPhoneInput("+66812345678")).toBe("+66 81 234 5678");
    expect(formatPhoneInput("0066812345678")).toBe("+66 81 234 5678");
    expect(formatPhoneInput("+4915123456789")).toBe("+4915123456789");
    expect(formatPhoneInput("812345678")).toBe("81 234 5678");
    expect(formatPhoneInput("")).toBe("");
  });
  it("enables the button only once the number looks complete", () => {
    expect(phoneLooksComplete("081 234 567")).toBe(false);
    expect(phoneLooksComplete("081 234 5678")).toBe(true);
    expect(phoneLooksComplete("02 123 4567")).toBe(true);
    expect(phoneLooksComplete("+66 81 234 5678")).toBe(true);
    expect(phoneLooksComplete("+49151234")).toBe(true);
    expect(phoneLooksComplete("12")).toBe(false);
  });
});

const item = (over: Partial<Parameters<typeof minNextBid>[0] & { buyNow: number | null; id: string; leaderKey: string | null }> = {}) => ({
  id: "a",
  leaderKey: null as string | null,
  bidCount: 0,
  startingBid: 1000,
  highBid: 0,
  minIncrement: 100,
  buyNow: null as number | null,
  ...over,
});

describe("bid amounts", () => {
  it("next bid is the starting bid, then high + increment", () => {
    expect(minNextBid(item())).toBe(1000);
    expect(minNextBid(item({ bidCount: 2, highBid: 1500 }))).toBe(1600);
  });
  it("stepper moves by the increment, never below the minimum or above buy-now", () => {
    const it = item({ bidCount: 1, highBid: 1000, buyNow: 1400 });
    expect(effectiveAmount(undefined, it)).toBe(1100);
    expect(stepAmount(1100, 1, it)).toBe(1200);
    expect(stepAmount(1100, -1, it)).toBe(1100);
    expect(stepAmount(1300, 1, it)).toBe(1400);
    expect(stepAmount(1400, 1, it)).toBe(1400);
    expect(canStepDown(1100, it)).toBe(false);
    expect(canStepUp(1400, it)).toBe(false);
    expect(canStepUp(1300, it)).toBe(true);
  });
  it("a chosen amount below a newer minimum snaps up", () => {
    expect(effectiveAmount(1200, item({ bidCount: 3, highBid: 1500 }))).toBe(1600);
  });
  it("offers only buy-now when the next bid would reach it", () => {
    expect(onlyBuyNow(item({ bidCount: 1, highBid: 1350, buyNow: 1400 }))).toBe(true);
    expect(onlyBuyNow(item({ bidCount: 1, highBid: 1000, buyNow: 1400 }))).toBe(false);
  });
  it("formats guest amounts compactly", () => {
    expect(formatAmount(2000, "THB")).toBe("฿2,000");
    expect(formatAmount(2000.5, "THB")).toBe("฿2,000.50");
    expect(formatAmount(15, "EUR")).toBe("€15");
  });
});

describe("winning / outbid / filters", () => {
  const me = { guest: null, leaderKey: "me", bidItemIds: ["a", "b"] };
  const items = [item({ id: "a", leaderKey: "me" }), item({ id: "b", leaderKey: "x" }), item({ id: "c", leaderKey: "x" })];
  it("derives per-item status from the opaque leader key", () => {
    expect(itemStatus(items[0], me)).toBe("winning");
    expect(itemStatus(items[1], me)).toBe("outbid");
    expect(itemStatus(items[2], me)).toBeNull();
    expect(itemStatus(items[0], null)).toBeNull();
  });
  it("filters and counts", () => {
    expect(filterItems(items, "all", me)).toHaveLength(3);
    expect(filterItems(items, "mine", me).map((i) => i.id)).toEqual(["a", "b"]);
    expect(filterItems(items, "winning", me).map((i) => i.id)).toEqual(["a"]);
    expect(filterItems(items, "outbid", me).map((i) => i.id)).toEqual(["b"]);
    expect(filterCounts(items, me)).toEqual({ all: 3, mine: 2, winning: 1, outbid: 1, watching: 0 });
    expect(wonItems(items, me).map((i) => i.id)).toEqual(["a"]);
  });
  it("detects winning → outbid transitions only", () => {
    const before = statusMap(items, me);
    const after = statusMap([item({ id: "a", leaderKey: "x" }), items[1], items[2]], me);
    expect(newlyOutbid(before, after)).toEqual(["a"]);
    expect(newlyOutbid(after, after)).toEqual([]);
    expect(newlyOutbid({}, after)).toEqual([]);
  });
});

describe("server-time countdown", () => {
  it("uses the server clock offset", () => {
    expect(clockOffset("2026-10-10T12:00:05.000Z", Date.parse("2026-10-10T12:00:00.000Z"))).toBe(5000);
    expect(clockOffset(undefined, 123)).toBe(0);
  });
  it("flips status at the exact second", () => {
    const ev = { status: "open" as const, startsAt: "2026-10-10T10:00:00Z", endsAt: "2026-10-10T12:00:00Z" };
    expect(statusAt(ev, Date.parse("2026-10-10T11:59:59Z"))).toBe("open");
    expect(statusAt(ev, Date.parse("2026-10-10T12:00:00Z"))).toBe("closed");
    expect(statusAt({ ...ev, status: "scheduled" }, Date.parse("2026-10-10T09:00:00Z"))).toBe("scheduled");
    expect(statusAt({ ...ev, status: "scheduled" }, Date.parse("2026-10-10T10:00:01Z"))).toBe("open");
    expect(statusAt({ ...ev, status: "closed" }, Date.parse("2026-10-10T11:00:00Z"))).toBe("closed");
  });
  it("formats remaining time", () => {
    expect(formatRemaining(3_909_000)).toBe("1:05:09");
    expect(formatRemaining(309_000)).toBe("05:09");
    expect(formatRemaining(-5)).toBe("00:00");
  });
});

describe("install hint", () => {
  const base = { standalone: false, dismissed: false, hasBid: true, canPrompt: false };
  it("detects platforms incl. LINE / in-app browsers", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ... Safari/604.1")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (iPhone; ...) Mobile/15E148 Line/14.9.0")).toBe("in-app");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14) ... Chrome/129 Mobile Safari/537.36")).toBe("android");
    expect(detectPlatform("... FBAN/FBIOS ...")).toBe("in-app");
  });
  it("is never shown before the first bid, when installed, dismissed or in LINE", () => {
    expect(shouldShowInstallHint({ ...base, platform: "ios" })).toBe(true);
    expect(shouldShowInstallHint({ ...base, platform: "ios", hasBid: false })).toBe(false);
    expect(shouldShowInstallHint({ ...base, platform: "ios", standalone: true })).toBe(false);
    expect(shouldShowInstallHint({ ...base, platform: "ios", dismissed: true })).toBe(false);
    expect(shouldShowInstallHint({ ...base, platform: "in-app" })).toBe(false);
    expect(shouldShowInstallHint({ ...base, platform: "android" })).toBe(false);
    expect(shouldShowInstallHint({ ...base, platform: "android", canPrompt: true })).toBe(true);
  });
});

describe("i18n string table", () => {
  it("interpolates and pluralises", () => {
    expect(t("bid.button", { amount: "฿2,000" })).toBe("Bid ฿2,000");
    expect(plural("bid.oneBid", "bid.bids", 1)).toBe("1 bid");
    expect(plural("bid.oneBid", "bid.bids", 3)).toBe("3 bids");
  });
  it("every string is non-empty (ready for translation tables)", () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe("");
  });
});

describe("round 3", () => {
  it("after the close the filters are All / Won / Not won", () => {
    expect(filtersFor(true)).toEqual(CLOSED_FILTERS);
    expect(filtersFor(true)).toEqual(["all", "winning", "outbid", "watching"]);
    expect(filtersFor(false)).toEqual(["all", "mine", "winning", "outbid", "watching"]);
    expect(en["bid.filter.closed.winning"]).toBe("Won");
    expect(en["bid.filter.closed.outbid"]).toBe("Not won");
    expect(en["bid.lost"]).toBe("Not won");
    expect(en["bid.winningBid"]).toBe("Winning bid");
  });

  it("short chip labels so all four fit a 390px phone", () => {
    const labels = ["all", "mine", "winning", "outbid"].map((f) => en[`bid.filter.${f}` as keyof typeof en]);
    expect(labels.join("").length).toBeLessThanOrEqual(22);
  });

  it("host money has thousands separators", () => {
    expect(formatMoney(7100, "THB")).toBe("฿7,100.00");
    expect(formatMoney(1234567.5, "USD")).toBe("$1,234,567.50");
    expect(formatAmount(7100, "THB")).toBe("฿7,100");
  });

  it("collect note names the physical prizes", () => {
    expect(listTitles(["Signed Jersey"])).toBe("Signed Jersey");
    expect(listTitles(["Signed Jersey", "Wine"])).toBe("Signed Jersey and Wine");
    expect(en["inv.collectItems"].replace("{items}", "Signed Jersey")).toBe("Collect Signed Jersey at the desk.");
  });

  it("install hint never shows while something more important is on screen", () => {
    const s = { platform: "ios" as const, standalone: false, dismissed: false, hasBid: true, canPrompt: false };
    expect(shouldShowInstallHint(s)).toBe(true);
    expect(shouldShowInstallHint({ ...s, suppressed: true })).toBe(false);
  });

  it("desk-only code screens never promise an email", () => {
    expect(en["code.resendDesk"]).toMatch(/desk/i);
    expect(en["code.resendDesk"]).not.toMatch(/send|email/i);
  });

  describe("pending code step survives an app switch", () => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    it("restores phone + delivery, expires, and clears", () => {
      savePendingJoin("AbC", { phone: "081 234 5678", via: "desk", email: null }, 1_000);
      expect(loadPendingJoin("abc", 2_000)).toMatchObject({ phone: "081 234 5678", via: "desk", email: null });
      expect(loadPendingJoin("abc", 1_000 + PENDING_JOIN_TTL_MS + 1)).toBeNull();
      savePendingJoin("abc", { phone: "0812345678", via: "email", email: "a•••@x.org" }, 5_000);
      clearPendingJoin("abc");
      expect(loadPendingJoin("abc", 6_000)).toBeNull();
      mem.set("fl_pending_join_abc", "{not json");
      expect(loadPendingJoin("abc", 6_000)).toBeNull();
    });
  });
});
