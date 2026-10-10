import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGATE_FALLBACK_DENYLIST, pwaOptions } from "../pwa.options";

const denied = (url: string) => NAVIGATE_FALLBACK_DENYLIST.some((re) => re.test(url));

describe("service worker config", () => {
  it("never answers /api navigations (exports, payslips, voucher PDFs) with the app shell", () => {
    for (const url of [
      "/api/host/events/abc/results.xlsx",
      "/api/host/events/abc/results.csv",
      "/api/host/invoices/1/payslip",
      "/api/host/events/abc/items/1/voucher",
      "/api/sponsors/1/logo",
    ]) {
      expect(denied(url)).toBe(true);
    }
    for (const url of ["/", "/host", "/e/abc", "/e/abc/bid", "/e/abc/invoice"]) {
      expect(denied(url)).toBe(false);
    }
  });

  it("new service worker takes over existing installs", () => {
    expect(pwaOptions.workbox?.skipWaiting).toBe(true);
    expect(pwaOptions.workbox?.clientsClaim).toBe(true);
    expect(pwaOptions.workbox?.cleanupOutdatedCaches).toBe(true);
  });

  it("manifest has a valid start_url and PNG icons that exist", () => {
    const m = pwaOptions.manifest as { start_url: string; icons: Array<{ src: string; type: string }> };
    expect(m.start_url).toBe("/");
    expect(m.icons.some((i) => i.type === "image/png")).toBe(true);
    for (const icon of m.icons) {
      expect(existsSync(path.join(import.meta.dirname, "..", "public", icon.src))).toBe(true);
    }
  });

  const swPath = path.join(import.meta.dirname, "..", "dist", "sw.js");
  it.skipIf(!existsSync(swPath))("built sw.js contains the /api denylist", () => {
    const sw = readFileSync(swPath, "utf8");
    expect(sw).toMatch(/denylist:\[\/\^\\\/api\\\/\/\]/);
    expect(sw).toContain("skipWaiting");
  });
});

describe("per-event guest manifest", () => {
  it("uses absolute start_url and icon URLs (it is served from a blob: URL)", async () => {
    const { buildGuestManifest } = await import("../src/lib/guestEvent");
    const m = buildGuestManifest("https://auction.example.org", "abc123", "Charity Gala");
    expect(m.start_url).toBe("https://auction.example.org/e/abc123/bid");
    for (const icon of m.icons) expect(icon.src.startsWith("https://auction.example.org/")).toBe(true);
    expect(() => new URL(m.start_url)).not.toThrow();
  });
});
