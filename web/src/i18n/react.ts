import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { language, subscribe, type Lang } from "./index";

/** Re-renders when the guest switches language. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, language, () => "en" as Lang);
}

/**
 * One subscriber at the root so every t() call updates.
 * The big screen sets data-screen-lang and owns documentElement.lang while it is open.
 */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const lang = useLang();
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.screenLang) return;
    root.lang = lang;
  }, [lang]);
  return children;
}
