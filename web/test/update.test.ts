import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheControlFor, IMMUTABLE, NO_CACHE } from "../cacheHeaders";
import { decideOnControllerChange, hasUnsavedInput, showsUpdateBanner } from "../src/lib/swUpdate";

describe("cache headers (vite preview + nginx)", () => {
  it("revalidates everything that decides the running version", () => {
    for (const p of ["/", "/index.html", "/host", "/e/abc/bid", "/sw.js", "/registerSW.js", "/workbox-5f3e.js", "/manifest.webmanifest", "/sw.js?x=1"]) {
      expect(cacheControlFor(p)).toBe(NO_CACHE);
    }
  });
  it("caches hashed assets forever and leaves the API alone", () => {
    expect(cacheControlFor("/assets/index-AbC123.js")).toBe(IMMUTABLE);
    expect(cacheControlFor("/assets/index-AbC123.css")).toBe(IMMUTABLE);
    expect(cacheControlFor("/api/health")).toBeNull();
  });
  it("nginx.conf has the same policy", () => {
    const conf = readFileSync(path.join(import.meta.dirname, "..", "nginx.conf"), "utf8");
    const block = (loc: string) => conf.slice(conf.indexOf(`location ${loc}`)).split("\n  }")[0];
    expect(block("/assets/")).toContain('Cache-Control "public, max-age=31536000, immutable"');
    for (const loc of ["= /sw.js", "~ ^/workbox-", "= /manifest.webmanifest", "= /index.html", "/ {"]) {
      expect(block(loc)).toContain('Cache-Control "no-cache"');
    }
    expect(block("/api/")).not.toContain("Cache-Control");
  });
});

describe("reload on service worker update", () => {
  it("reloads when a new version takes over an already-controlled page", () => {
    expect(decideOnControllerChange({ hadController: true, dirty: false, alreadyReloading: false })).toBe("reload");
  });
  it("prompts instead of reloading when the user has unsaved input", () => {
    expect(decideOnControllerChange({ hadController: true, dirty: true, alreadyReloading: false })).toBe("prompt");
  });
  it("ignores the first install and repeated events", () => {
    expect(decideOnControllerChange({ hadController: false, dirty: false, alreadyReloading: false })).toBe("ignore");
    expect(decideOnControllerChange({ hadController: true, dirty: false, alreadyReloading: true })).toBe("ignore");
  });
  it("only counts edited fields that are still on screen and non-empty", () => {
    expect(hasUnsavedInput([])).toBe(false);
    expect(hasUnsavedInput([{ isConnected: true, type: "text", value: "Brunch" }])).toBe(true);
    expect(hasUnsavedInput([{ isConnected: false, type: "text", value: "Brunch" }])).toBe(false); // form reset/remounted
    expect(hasUnsavedInput([{ isConnected: true, type: "text", value: "  " }])).toBe(false);
    expect(hasUnsavedInput([{ isConnected: true, type: "file", files: { length: 1 } }])).toBe(true);
    expect(hasUnsavedInput([{ isConnected: true, type: "checkbox", checked: true }])).toBe(false);
  });
});

describe("guest pages stay frictionless", () => {
  it("the update banner only appears on host pages", () => {
    expect(showsUpdateBanner("/host")).toBe(true);
    for (const p of ["/", "/e/abc", "/e/abc/bid", "/e/abc/invoice", "/hostile"]) expect(showsUpdateBanner(p)).toBe(false);
  });
});
