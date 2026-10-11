/**
 * Service worker registration + reliable updates after a deploy.
 *
 * Round 3 (stale app needed 4 reloads): the old service worker answered every navigation with its
 * precached index.html (cache-first) and the old page never reloaded itself, while Chrome postpones
 * its own update check as long as navigations keep coming. Now
 * - navigations are network-first (pwa.options.ts), so a deploy is visible on the first load;
 * - we call reg.update() on every load, not only every 10 minutes;
 * - kill-switch: /version.json carries the deployed build id; if this bundle is older we reload once
 *   (guarded per build in sessionStorage, so it can never loop);
 * - controllerchange reloads only when the running bundle is actually outdated.
 *
 * The SW uses skipWaiting/clientsClaim, so a new version takes control of open tabs right away —
 * but the page keeps running the old JS until it reloads. We therefore reload on `controllerchange`
 * unless the user is in the middle of typing something. Then the reload is deferred and happens
 * silently as soon as the input is gone (submitted/cleared) or the tab is hidden — guests never get an
 * extra prompt. Host pages additionally show a non-blocking "Update available — Reload" banner. We also actively check for updates (interval + when
 * the tab becomes visible), and register with updateViaCache: "none" so sw.js is never read from
 * the HTTP cache.
 */

export type UpdateDecision = "ignore" | "reload" | "prompt";

/** The id of the bundle running in this page (compiled in by vite.config.ts). */
export const RUNNING_BUILD: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

/** Pure decision used on controllerchange. */
export function decideOnControllerChange(s: {
  hadController: boolean;
  dirty: boolean;
  alreadyReloading: boolean;
  /** true when /version.json says this page already runs the deployed build (no reload needed). */
  alreadyCurrent?: boolean;
}): UpdateDecision {
  // First install (page wasn't controlled yet): nothing old is running, nothing to do.
  if (!s.hadController || s.alreadyReloading || s.alreadyCurrent) return "ignore";
  return s.dirty ? "prompt" : "reload";
}

export type VersionDecision = "current" | "reload" | "prompt" | "gave-up";

/** Pure decision for the kill-switch: running bundle vs. the build id the server publishes. */
export function decideOnVersion(s: { running: string; deployed: string | null; triedReloadFor: string | null; dirty: boolean }): VersionDecision {
  if (!s.deployed || s.deployed === s.running || s.running === "dev") return "current";
  // Already reloaded once for this deploy and still old (e.g. an old SW still in charge): don't loop;
  // the controllerchange reload finishes the job when the new SW takes over.
  if (s.triedReloadFor === s.deployed) return "gave-up";
  return s.dirty ? "prompt" : "reload";
}

const RELOAD_GUARD_KEY = "fl_reloaded_for_build";

function readGuard(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY);
  } catch {
    return null;
  }
}
function writeGuard(build: string) {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, build);
  } catch {
    /* ignore */
  }
}

/** The build id currently deployed (null when offline / not available). */
export async function fetchDeployedBuild(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: unknown };
    return typeof data.build === "string" && data.build ? data.build : null;
  } catch {
    return null;
  }
}

type FieldLike = { isConnected: boolean; type?: string; value?: string; checked?: boolean; files?: { length: number } | null };

/** A form is "dirty" when a field the user edited is still on screen and still holds input. */
export function hasUnsavedInput(edited: Iterable<FieldLike>): boolean {
  for (const el of edited) {
    if (!el.isConnected) continue;
    if (el.type === "file") {
      if (el.files && el.files.length > 0) return true;
    } else if (el.type === "checkbox" || el.type === "radio") {
      continue;
    } else if ((el.value ?? "").trim() !== "") {
      return true;
    }
  }
  return false;
}

// --- tiny store for the banner -------------------------------------------------------------
let updateReady = false;
const listeners = new Set<() => void>();
export function subscribeUpdate(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function isUpdateReady() {
  return updateReady;
}

/** Only hosts see the banner; guest pages update silently (zero friction). */
export function showsUpdateBanner(pathname: string): boolean {
  return pathname === "/host" || pathname.startsWith("/host/");
}
function setUpdateReady() {
  updateReady = true;
  for (const cb of listeners) cb();
}

const UPDATE_CHECK_MS = 10 * 60_000;

export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  const edited = new Set<FieldLike>();
  let reloading = false;

  document.addEventListener(
    "input",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) edited.add(t as unknown as FieldLike);
    },
    true,
  );

  const reloadNow = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  let deferring = false;
  const deferReload = () => {
    setUpdateReady();
    if (deferring) return;
    deferring = true;
    // Deferred silent reload once nothing unsaved is on screen (or the tab is hidden).
    const tryReload = () => {
      if (document.visibilityState === "hidden" || !hasUnsavedInput(edited)) reloadNow();
    };
    setInterval(tryReload, 2000);
    document.addEventListener("visibilitychange", tryReload);
  };

  sw.addEventListener("controllerchange", async () => {
    // With network-first navigations this page usually already runs the new bundle: then the new
    // SW taking over needs no reload at all.
    const deployed = hadController && !reloading ? await fetchDeployedBuild() : null;
    const decision = decideOnControllerChange({
      hadController,
      dirty: hasUnsavedInput(edited),
      alreadyReloading: reloading,
      alreadyCurrent: deployed != null && deployed === RUNNING_BUILD,
    });
    if (decision === "reload") reloadNow();
    else if (decision === "prompt") deferReload();
  });

  let registration: ServiceWorkerRegistration | null = null;
  const checkForUpdate = () => {
    if (navigator.onLine !== false) registration?.update().catch(() => {});
  };

  // Kill-switch: is this bundle older than what is deployed? Then get the new one now.
  const checkVersion = async () => {
    if (reloading) return;
    const deployed = await fetchDeployedBuild();
    const decision = decideOnVersion({ running: RUNNING_BUILD, deployed, triedReloadFor: readGuard(), dirty: hasUnsavedInput(edited) });
    if (decision === "current" || decision === "gave-up") {
      if (decision === "gave-up") checkForUpdate();
      return;
    }
    writeGuard(deployed!);
    // Let a new SW install first (bounded), so the reload is served by it.
    if (registration) await Promise.race([registration.update().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    if (decision === "reload") reloadNow();
    else deferReload();
  };

  const start = () => {
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        // Don't wait for Chrome's own (postponed) check: look for a new SW on every load.
        checkForUpdate();
        setInterval(checkForUpdate, UPDATE_CHECK_MS);
      })
      .catch((err) => console.warn("service worker registration failed", err));
    checkVersion();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkForUpdate();
    checkVersion();
  });
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
}
