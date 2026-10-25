import { FormEvent, useState } from "react";
import { t } from "../i18n";
import { formatAmount, type Currency } from "../lib/money";
import { customBidAmount } from "../lib/p2";

export function MaxBidSheet({
  title,
  floor,
  current,
  ccy,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  floor: number;
  current: number | null;
  ccy: Currency;
  busy: boolean;
  onSave: (amount: number) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(current != null ? String(current) : String(floor));
  const parsed = customBidAmount(raw, floor);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (parsed.ok) onSave(parsed.amount);
  }
  return (
    <div className="g-sheet-back" role="presentation" onClick={onClose}>
      <form
        className="g-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="max-bid-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="g-sheet-bar">
          <h2 id="max-bid-title">{t("max.title")}</h2>
          <button type="button" className="g-sheet-x" aria-label={t("max.cancel")} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="g-muted">{title}</p>
        <p>{t("max.intro")}</p>
        <label className="g-field-label" htmlFor="max-bid-amount">{t("max.label")}</label>
        <input
          id="max-bid-amount"
          className="g-big-input"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          autoFocus
        />
        {!parsed.ok && <p className="g-inline-error">{t("max.tooLow", { amount: formatAmount(floor, ccy) })}</p>}
        <button type="submit" className="g-bid" disabled={busy || !parsed.ok}>
          {busy ? t("bid.sending") : current != null ? t("max.save") : t("max.set")}
        </button>
      </form>
    </div>
  );
}
