import type { Connect, Plugin } from "vite";

export const NO_CACHE = "no-cache";
export const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Cache policy for the built web app (mirrored in nginx.conf):
 * - hashed build output under /assets/ never changes → cache forever;
 * - everything that decides *which* version runs (sw.js, workbox runtime, registerSW, the
 *   manifest, index.html and SPA routes) must be revalidated on every load, otherwise browsers keep
 *   an old service worker / shell for a while after a deploy;
 * - /api/ is the API's business (returns null: header left alone).
 */
export function cacheControlFor(pathname: string): string | null {
  const p = pathname.split("?")[0];
  if (p.startsWith("/api/")) return null;
  if (p.startsWith("/assets/")) return IMMUTABLE;
  return NO_CACHE;
}

function middleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const cc = cacheControlFor(req.url ?? "/");
    if (cc) res.setHeader("Cache-Control", cc);
    next();
  };
}

/** Applies cacheControlFor() to `vite preview` (and dev, harmlessly). */
export function cacheHeadersPlugin(): Plugin {
  return {
    name: "fluesterlos-cache-headers",
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
