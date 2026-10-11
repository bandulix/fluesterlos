import { t } from "../i18n";

/** Compact, non-blocking "Outbid: <item>" bar with a one-tap re-bid. */
export function OutbidBanner({ title, amountLabel, onBid, onClose }: { title: string; amountLabel: string; onBid: () => void; onClose: () => void }) {
  return (
    <div className="g-outbid" role="status" aria-live="assertive">
      <span className="g-outbid-text">{t("bid.outbidBanner", { title })}</span>
      <button type="button" className="g-outbid-bid" onClick={onBid}>
        {t("bid.outbidAction", { amount: amountLabel })}
      </button>
      <button type="button" className="g-outbid-close" aria-label={t("install.dismiss")} onClick={onClose}>
        ×
      </button>
    </div>
  );
}
