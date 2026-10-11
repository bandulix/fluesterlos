import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheControlFor, IMMUTABLE, NO_CACHE, NO_STORE } from "../cacheHeaders";
import { decideOnControllerChange, decideOnVersion, fetchDeployedBuild, hasUnsavedInput, showsUpdateBanner } from "../src/lib/swUpdate";

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
    expect(block("= /version.json")).toContain('Cache-Control "no-store"');
  });
  it("never stores version.json", () => {
    expect(cacheControlFor("/version.json")).toBe(NO_STORE);
  });
});

describe("stale bundle kill-switch", () => {
  const base = { running: "b1", triedReloadFor: null, dirty: false };
  it("does nothing when the running bundle is the deployed one (or offline / dev)", () => {
    expect(decideOnVersion({ ...base, deployed: "b1" })).toBe("current");
    expect(decideOnVersion({ ...base, deployed: null })).toBe("current");
    expect(decideOnVersion({ ...base, running: "dev", deployed: "b2" })).toBe("current");
  });
  it("reloads once when a newer build is deployed, defers while the guest is typing", () => {
    expect(decideOnVersion({ ...base, deployed: "b2" })).toBe("reload");
    expect(decideOnVersion({ ...base, deployed: "b2", dirty: true })).toBe("prompt");
  });
  it("never loops: one reload per deployed build", () => {
    expect(decideOnVersion({ ...base, deployed: "b2", triedReloadFor: "b2" })).toBe("gave-up");
    expect(decideOnVersion({ ...base, deployed: "b3", triedReloadFor: "b2" })).toBe("reload");
  });
  it("reads the build id without caches and tolerates failures", async () => {
    const calls: Array<RequestInit | undefined> = [];
    const ok = (async (_u: string, init?: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ build: "b9" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchDeployedBuild(ok)).toBe("b9");
    expect(calls[0]?.cache).toBe("no-store");
    expect(await fetchDeployedBuild((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchDeployedBuild((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("reload on service worker update", () => {
  it("skips the reload when the page already runs the deployed build (network-first load)", () => {
    expect(decideOnControllerChange({ hadController: true, dirty: false, alreadyReloading: false, alreadyCurrent: true })).toBe("ignore");
  });
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
