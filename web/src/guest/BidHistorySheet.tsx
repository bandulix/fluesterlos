import { t } from "../i18n";
import { formatAmount, type Currency } from "../lib/money";

export type HistoryBid = {
  rank: number;
  amount: number;
  name: string;
  mine: boolean;
  createdAt: string;
};

/** Ranked bids. Later rows fade. Second place within one increment can bid in one tap. */
export function BidHistorySheet({
  title,
  bids,
  soClose,
  ccy,
  busy,
  onBid,
  onClose,
}: {
  title: string;
  bids: HistoryBid[];
  soClose: { amount: number } | null;
  ccy: Currency;
  busy: boolean;
  onBid: (amount: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="g-sheet-back" role="presentation" onClick={onClose}>
      <div
        className="g-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bid-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="g-sheet-bar">
          <h2 id="bid-history-title">{t("history.title")}</h2>
          <button type="button" className="g-sheet-x" aria-label={t("max.cancel")} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="g-muted">{title}</p>
        {bids.length === 0 ? (
          <p>{t("history.empty")}</p>
        ) : (
          <ol className="g-history">
            {bids.map((row, i) => (
              <li key={`${row.createdAt}-${row.rank}`} style={{ opacity: Math.max(0.45, 1 - i * 0.12) }}>
                <span className="g-history-rank">{row.rank}</span>
                <span>{row.mine ? t("history.you") : row.name}</span>
                <strong>{formatAmount(row.amount, ccy)}</strong>
              </li>
            ))}
          </ol>
        )}
        {soClose && (
          <div className="g-so-close">
            <p>{t("history.soClose")}</p>
            <button type="button" className="g-bid" disabled={busy} onClick={() => onBid(soClose.amount)}>
              {t("history.bid", { amount: formatAmount(soClose.amount, ccy) })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
