import { FormEvent, useState } from "react";
import { t } from "../i18n";

/** Small, dismissible "Show your name on the board?" — never asked up front. */
export function NameNudge({
  currentName,
  onSave,
  onDismiss,
  autoFocus = false,
}: {
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onDismiss: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
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
    <form className="g-nudge" onSubmit={submit} aria-label={t("name.prompt")}>
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

/** Brief inline "✓ Saved" where the nudge was, so saving visibly worked. */
export function NameSaved({ name }: { name: string }) {
  return (
    <p className="g-saved" role="status">
      {t("name.savedInline", { name })}
    </p>
  );
}
