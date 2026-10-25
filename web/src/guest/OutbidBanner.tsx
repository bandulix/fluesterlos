import { t } from "../i18n";

/** Card under the header: red only on the icon and the left edge, gold action. */
export function OutbidBanner({ title, amountLabel, actionLabel, onJump, onClose }: { title: string; amountLabel: string; actionLabel: string; onJump: () => void; onClose: () => void }) {
  return (
    <div className="g-outbid" role="status" aria-live="assertive">
      <span className="g-outbid-icon" aria-hidden="true">!</span>
      <span className="g-outbid-text">{t("bid.outbidBanner", { title, amount: amountLabel })}</span>
      <button type="button" className="g-outbid-bid" onClick={onJump}>
        {actionLabel}
        <span aria-hidden="true"> →</span>
      </button>
      <button type="button" className="g-outbid-close" aria-label={t("install.dismiss")} onClick={onClose}>
        ×
      </button>
    </div>
  );
}
