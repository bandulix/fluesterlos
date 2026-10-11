import { FormEvent, useState } from "react";
import { t } from "../i18n";
import { useBottomBarSpace } from "./useBottomBarSpace";

/** Small, dismissible "Show your name on the board?" — never asked up front. */
export function NameNudge({
  currentName,
  onSave,
  onDismiss,
  autoFocus = false,
  sheet = false,
}: {
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onDismiss: () => void;
  autoFocus?: boolean;
  /** Bottom sheet over the list (does not push content). */
  sheet?: boolean;
}) {
  const [name, setName] = useState("");
  const sheetRef = useBottomBarSpace<HTMLFormElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      document.getElementById("g-board-name")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={sheet ? sheetRef : undefined} className={`g-nudge${sheet ? " is-sheet" : ""}`} onSubmit={submit} aria-label={t("name.prompt")}>
      <div className="g-nudge-text">
        <strong>{t("name.prompt")}</strong>
        <span>{t("name.current", { name: currentName })}</span>
      </div>
      <div className="g-nudge-row">
        <label className="sr-only" htmlFor="g-board-name">{t("name.label")}</label>
        <input
          id="g-board-name"
          name="boardName"
          value={name}
          maxLength={40}
          autoComplete="nickname"
          enterKeyHint="done"
          placeholder={t("name.placeholder")}
          autoFocus={autoFocus}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="g-btn-small" disabled={busy}>
          {t("name.save")}
        </button>
      </div>
      {error && <p className="g-error" role="alert">{error}</p>}
      <button type="button" className="g-close" aria-label={t("name.dismiss")} title={t("name.dismiss")} onClick={onDismiss}>
        ×
      </button>
    </form>
  );
}
