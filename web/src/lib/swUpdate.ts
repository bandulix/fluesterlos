/**
 * Service worker registration + reliable updates after a deploy.
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

/** Pure decision used on controllerchange. */
export function decideOnControllerChange(s: { hadController: boolean; dirty: boolean; alreadyReloading: boolean }): UpdateDecision {
  // First install (page wasn't controlled yet): nothing old is running, nothing to do.
  if (!s.hadController || s.alreadyReloading) return "ignore";
  return s.dirty ? "prompt" : "reload";
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

  sw.addEventListener("controllerchange", () => {
    const decision = decideOnControllerChange({ hadController, dirty: hasUnsavedInput(edited), alreadyReloading: reloading });
    if (decision === "reload") {
      reloading = true;
      window.location.reload();
    } else if (decision === "prompt") {
      setUpdateReady();
      // Deferred silent reload once nothing unsaved is on screen (or the tab is hidden).
      const tryReload = () => {
        if (reloading) return;
        if (document.visibilityState === "hidden" || !hasUnsavedInput(edited)) {
          reloading = true;
          window.location.reload();
        }
      };
      setInterval(tryReload, 2000);
      document.addEventListener("visibilitychange", tryReload);
    }
  });

  window.addEventListener("load", () => {
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        const check = () => {
          if (navigator.onLine !== false) reg.update().catch(() => {});
        };
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch((err) => console.warn("service worker registration failed", err));
  });
}
