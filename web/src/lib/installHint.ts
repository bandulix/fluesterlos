export type InstallPlatform = "ios" | "android" | "in-app" | "desktop";

/** LINE / Facebook / Instagram in-app browsers can't install a PWA: we never nag there. */
export function detectPlatform(ua: string): InstallPlatform {
  if (/\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK/i.test(ua)) return "in-app";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * Non-blocking "add to home screen" hint: only after the guest joined *and* placed a bid
 * (never on the first screen), never when already installed or dismissed, and only where it can
 * actually work (iOS share sheet, Android with an install prompt).
 */
export function shouldShowInstallHint(s: {
  platform: InstallPlatform;
  standalone: boolean;
  dismissed: boolean;
  hasBid: boolean;
  canPrompt: boolean;
}): boolean {
  if (s.standalone || s.dismissed || !s.hasBid) return false;
  if (s.platform === "ios") return true;
  if (s.platform === "android" || s.platform === "desktop") return s.canPrompt;
  return false;
}

const KEY = "fl_install_hint_dismissed";
export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function dismissInstallHint(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}
