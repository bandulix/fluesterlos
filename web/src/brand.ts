/**
 * Event branding for this checkout.
 *
 * Thai.GER Supporters (https://thaigersupporters.info) is the charity
 * tournament this build is dressed for. The gala theme in theme.css stays
 * the generic default. To dress another event:
 *   1. Set `id` to a `[data-theme]` block (gala, calm, or a new file in
 *      web/public/themes/) and the same value on <html data-theme> in index.html.
 *   2. Point the logo sources at that event's files, or use "" to show no logo.
 *   3. Put any extra overrides in web/public/custom.css.
 */
export const brand = {
  id: "thaiger",
  name: "Thai.GER Supporters",
  /** Shield. Works on light and dark. Empty string hides it. */
  markSrc: "/brand/thaiger/mark.png",
  /** Wide wordmark. The file is black ink; the theme plates it on ivory. Empty string hides it. */
  lockupSrc: "/brand/thaiger/lockup.png",
  themeColor: "#0c1222",
  backgroundColor: "#0c1222",
  icon192: "/brand/thaiger/icon-192.png",
  icon512: "/brand/thaiger/icon-512.png",
} as const;
