import type { VitePWAOptions } from "vite-plugin-pwa";
import { brand } from "./src/brand";

/**
 * Navigations that must reach the network, never the app shell: the API (exports, payslips,
 * voucher PDFs, photos, logos, QR) is served under /api/.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [/^\/api\//];

/** Page navigations the service worker handles (network-first): every SPA route, never /api/. */
export function isAppNavigation({ request, url }: { request: { mode: string }; url: URL }): boolean {
  return request.mode === "navigate" && !url.pathname.startsWith("/api/");
}

/**
 * Bumping this renames the precache, so `cleanupOutdatedCaches` drops every older precache
 * (including the pre-round-3 "workbox-precache-…" one that served a stale index.html cache-first).
 */
export const CACHE_ID = "fluesterlos-v5";
/** How long a navigation waits for the network before falling back to the cached app shell. */
export const NAVIGATION_TIMEOUT_SECONDS = 4;

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  // Registered by src/lib/swUpdate.ts, which also reloads (or prompts) when a new version takes over.
  injectRegister: false,
  includeAssets: [
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    brand.icon192.replace(/^\//, ""),
    brand.icon512.replace(/^\//, ""),
  ],
  manifest: {
    id: "/",
    name: "FlüsterLos",
    short_name: "FlüsterLos",
    description: "Open-source silent auction",
    theme_color: brand.themeColor,
    background_color: brand.backgroundColor,
    display: "standalone",
    start_url: "/",
    scope: "/",
    icons: [
      {
        src: brand.icon512,
        sizes: `${brand.logoWidth}x${brand.logoHeight}`,
        type: "image/png",
        purpose: "any",
      },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,ico,png,woff2}"],
    // Host code is lazy-loaded and not precached, so guests' phones never download it.
    globIgnores: ["**/HostShell-*.js", "**/HostShell-*.css"],
    cacheId: CACHE_ID,
    // No cache-first app shell: a deploy must be visible on the FIRST load. Navigations go to the
    // network first and only fall back to a cached page (or the precached index.html) when offline
    // or when the network takes longer than NAVIGATION_TIMEOUT_SECONDS.
    navigateFallback: null,
    // New service worker takes over open tabs right away; the app reloads once on controllerchange.
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: isAppNavigation,
        handler: "NetworkFirst",
        options: {
          cacheName: `${CACHE_ID}-pages`,
          networkTimeoutSeconds: NAVIGATION_TIMEOUT_SECONDS,
          expiration: { maxEntries: 16 },
          cacheableResponse: { statuses: [200] },
          precacheFallback: { fallbackURL: "index.html" },
        },
      },
    ],
  },
};
