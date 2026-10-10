import type { VitePWAOptions } from "vite-plugin-pwa";

/**
 * Navigations that must reach the network, never the app shell: the API (exports, payslips,
 * voucher PDFs, photos, logos, QR) is served under /api/.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [/^\/api\//];

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  // Registered by src/lib/swUpdate.ts, which also reloads (or prompts) when a new version takes over.
  injectRegister: false,
  includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
  manifest: {
    id: "/",
    name: "FlüsterLos",
    short_name: "FlüsterLos",
    description: "Open-source silent auction",
    theme_color: "#0f766e",
    background_color: "#0b1220",
    display: "standalone",
    start_url: "/",
    scope: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,svg,ico,png}"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
    // New service worker takes over open tabs right away, so old installs drop the bad fallback.
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    runtimeCaching: [],
  },
};
