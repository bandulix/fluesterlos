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
  /**
   * Header logo the live site serves, byte for byte.
   * https://thaigersupporters.info/wp-content/uploads/2025/08/EmbeddedImage.png
   * 1280×719. Do not crop, recolor, or redraw this file.
   */
  logoSourceUrl: "https://thaigersupporters.info/wp-content/uploads/2025/08/EmbeddedImage.png",
  logoWidth: 1280,
  logoHeight: 719,
  /** Same file for the mark and the wide lockup. Empty string hides it. */
  markSrc: "/brand/thaiger/logo.png",
  lockupSrc: "/brand/thaiger/logo.png",
  themeColor: "#231f20",
  backgroundColor: "#231f20",
  icon192: "/brand/thaiger/logo.png",
  icon512: "/brand/thaiger/logo.png",
} as const;
