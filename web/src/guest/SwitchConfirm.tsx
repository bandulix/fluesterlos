import { t } from "../i18n";

/** Inline "are you sure?" for switching the number on this phone — no modal, no surprise logout. */
export function SwitchConfirm({ onYes, onNo, busy = false }: { onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <div className="g-confirm" role="group" aria-label={t("bid.switch")}>
      <p>{t("bid.switchConfirm")}</p>
      <div className="g-confirm-row">
        <button type="button" className="g-btn-small g-btn-quiet" onClick={onNo} autoFocus>
          {t("bid.switchNo")}
        </button>
        <button type="button" className="g-btn-small" disabled={busy} onClick={onYes}>
          {t("bid.switchYes")}
        </button>
      </div>
    </div>
  );
}
