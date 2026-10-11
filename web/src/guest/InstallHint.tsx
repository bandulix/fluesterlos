import { useEffect, useState } from "react";
import { t } from "../i18n";
import { detectPlatform, dismissInstallHint, installHintDismissed, isStandalone, shouldShowInstallHint } from "../lib/installHint";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

/** Non-blocking add-to-home-screen hint (only after the first bid; never in LINE/in-app browsers). */
export function InstallHint({ hasBid }: { hasBid: boolean }) {
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

  if (!shouldShowInstallHint({ platform, standalone: isStandalone(), dismissed, hasBid, canPrompt: promptEvent != null })) return null;

  const dismiss = () => {
    dismissInstallHint();
    setDismissed(true);
  };

  return (
    <aside className="g-install" aria-label={t("install.title")}>
      <span className="g-install-icon" aria-hidden="true">📲</span>
      <div>
        <strong>{t("install.title")}</strong>
        <p>{platform === "ios" ? t("install.ios") : t("install.android")}</p>
        {platform !== "ios" && promptEvent && (
          <button
            type="button"
            className="g-btn-small"
            onClick={() => {
              promptEvent.prompt().catch(() => undefined).finally(dismiss);
            }}
          >
            {t("install.button")}
          </button>
        )}
      </div>
      <button type="button" className="g-close" aria-label={t("install.dismiss")} onClick={dismiss}>
        ×
      </button>
    </aside>
  );
}
