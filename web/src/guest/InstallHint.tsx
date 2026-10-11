import { useEffect, useState } from "react";
import { t } from "../i18n";
import { detectPlatform, dismissInstallHint, installHintDismissed, isStandalone, shouldShowInstallHint } from "../lib/installHint";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

/**
 * Small dismissible bottom bar: "add to home screen" (only after the first bid; never in LINE /
 * in-app browsers; never while the outbid banner or a bid toast is on screen).
 */
export function InstallHint({ hasBid, suppressed = false }: { hasBid: boolean; suppressed?: boolean }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(installHintDismissed);
  const platform = detectPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!shouldShowInstallHint({ platform, standalone: isStandalone(), dismissed, hasBid, canPrompt: promptEvent != null, suppressed })) return null;

  const dismiss = () => {
    dismissInstallHint();
    setDismissed(true);
  };

  return (
    <aside className="g-install" aria-label={t("install.title")}>
      <span className="g-install-icon" aria-hidden="true">📲</span>
      <p className="g-install-text">{platform === "ios" ? t("install.ios") : t("install.android")}</p>
      {platform !== "ios" && promptEvent && (
        <button
          type="button"
          className="g-install-add"
          onClick={() => {
            promptEvent.prompt().catch(() => undefined).finally(dismiss);
          }}
        >
          {t("install.button")}
        </button>
      )}
      <button type="button" className="g-install-close" aria-label={t("install.dismiss")} onClick={dismiss}>
        ×
      </button>
    </aside>
  );
}
