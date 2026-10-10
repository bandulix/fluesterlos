import { detectPlatform } from "./installHint";

/**
 * Save an image on a phone: the share sheet on iOS/Android ("Save Image" → Photos), a plain download
 * elsewhere. Callers also show a long-press hint, which works in LINE / in-app browsers where both
 * of these may be unavailable.
 */
export async function saveImage(src: string, filename: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await (await fetch(src, { credentials: "include" })).blob();
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const platform = detectPlatform(navigator.userAgent);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if ((platform === "ios" || platform === "android") && nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
