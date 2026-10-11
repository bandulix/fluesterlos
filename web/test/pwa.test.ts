import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE_ID, isAppNavigation, NAVIGATE_FALLBACK_DENYLIST, pwaOptions } from "../pwa.options";

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

  it("navigations are network-first (never the cached shell first), /api navigations untouched", () => {
    expect(pwaOptions.workbox?.navigateFallback).toBeNull();
    const nav = pwaOptions.workbox?.runtimeCaching?.[0];
    expect(nav?.handler).toBe("NetworkFirst");
    expect(nav?.options?.precacheFallback?.fallbackURL).toBe("index.html");
    expect(nav?.options?.cacheName).toBe(`${CACHE_ID}-pages`);
    const at = (p: string, mode = "navigate") => isAppNavigation({ request: { mode }, url: new URL(p, "https://x.example") });
    expect(at("/e/abc/bid")).toBe(true);
    expect(at("/host")).toBe(true);
    expect(at("/api/host/events/abc/results.xlsx")).toBe(false);
    expect(at("/e/abc", "cors")).toBe(false);
  });

  it("versioned precache name, so old (cache-first) precaches are cleaned up on activate", () => {
    expect(pwaOptions.workbox?.cacheId).toBe(CACHE_ID);
    expect(CACHE_ID).toMatch(/^fluesterlos-v\d+$/);
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
  it.skipIf(!existsSync(swPath))("built sw.js: network-first navigations, no cache-first shell, /api excluded", () => {
    const sw = readFileSync(swPath, "utf8");
    expect(sw).toContain("NetworkFirst");
    expect(sw).toContain('startsWith("/api/")');
    expect(sw).not.toContain("createHandlerBoundToURL");
    expect(sw).toContain("skipWaiting");
    // index.html is precached with a content revision, so a new deploy never serves the old shell.
    expect(sw).toMatch(/url:"index\.html",revision:"[0-9a-f]+"/);
  });

  const versionPath = path.join(import.meta.dirname, "..", "dist", "version.json");
  it.skipIf(!existsSync(versionPath))("build publishes version.json (kill-switch) and does not precache it", () => {
    const v = JSON.parse(readFileSync(versionPath, "utf8"));
    expect(typeof v.build).toBe("string");
    expect(readFileSync(swPath, "utf8")).not.toContain("version.json");
  });

  it("the app registers the service worker itself (so it can reload on update)", () => {
    expect(pwaOptions.injectRegister).toBe(false);
    const main = readFileSync(path.join(import.meta.dirname, "..", "src", "main.tsx"), "utf8");
    expect(main).toContain("registerServiceWorker()");
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

describe("guests don't download host code", () => {
  it("host pages are lazy-loaded and not precached", () => {
    const app = readFileSync(path.join(import.meta.dirname, "..", "src", "App.tsx"), "utf8");
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/HostShell"\)\)/);
    expect(app).not.toMatch(/from "\.\/pages\/HostPage"/);
    expect(pwaOptions.workbox?.globIgnores).toContain("**/HostShell-*.js");
  });
  const assets = path.join(import.meta.dirname, "..", "dist", "assets");
  it.skipIf(!existsSync(assets))("built entry chunk contains no host UI", async () => {
    const { readdirSync } = await import("node:fs");
    const html = readFileSync(path.join(import.meta.dirname, "..", "dist", "index.html"), "utf8");
    const entry = html.match(/src="\/assets\/([^"]+\.js)"/)![1];
    const js = readFileSync(path.join(assets, entry), "utf8");
    expect(js).not.toContain("Register owner");
    expect(js).toContain("Start bidding");
    expect(readdirSync(assets).some((f) => f.startsWith("HostShell-"))).toBe(true);
  });
});
