import { memo } from "react";
import { assetUrl, LiveItem } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";
import { canStepDown, canStepUp, effectiveAmount, isFixedPrice, ItemStatus, onlyBuyNow } from "../lib/bidLogic";
import { dedupeDescription } from "../lib/text";
import { plural, t } from "../i18n";

export type ItemCardProps = {
  item: LiveItem;
  ccy: Currency;
  status: ItemStatus;
  eventStatus: "scheduled" | "open" | "closed";
  chosen: number | undefined;
  busy: boolean;
  highlight: boolean;
  onStep: (itemId: string, dir: 1 | -1) => void;
  onBid: (item: LiveItem, amount: number) => void;
};

function ItemCardImpl({ item: it, ccy, status, eventStatus, chosen, busy, highlight, onStep, onBid }: ItemCardProps) {
  const open = eventStatus === "open";
  const closed = eventStatus === "closed";
  const sold = Boolean(it.soldViaBuyNow);
  const amount = effectiveAmount(chosen, it);
  const buyNowOnly = onlyBuyNow(it);
  const isBuyNow = it.buyNow != null && amount >= it.buyNow;
  const fmt = (n: number) => formatAmount(n, ccy);
  // After the close an outbid item is simply "Not won" — neutral grey, no red alarm, no arrow.
  const fixed = isFixedPrice(it);
  // Bought outright (buy-now / fixed price): the buyer owns it ("Yours ✓"), everyone else sees "Sold" —
  // never "You're winning" / "Outbid", the item is over.
  const shownStatus = sold ? (status === "winning" ? "winning" : "sold") : closed && status === "outbid" ? "lost" : status;
  const statusLabel = sold
    ? status === "winning"
      ? t("bid.yours")
      : t("bid.soldShort")
    : status === "winning"
      ? t(closed ? "bid.won" : "bid.winning")
      : status === "outbid"
        ? t(closed ? "bid.lost" : "bid.outbid")
        : null;
  const statusIcon = sold ? "" : shownStatus === "winning" ? "✓ " : shownStatus === "outbid" ? "↑ " : "";
  const description = dedupeDescription(it.title, it.description);
  const titleId = `item-${it.id}-title`;

  return (
    <article
      id={`item-${it.id}`}
      className={`g-item${shownStatus ? ` is-${shownStatus}` : ""}${highlight ? " is-flash" : ""}${sold || (closed && !status) ? " is-done" : ""}`}
      aria-labelledby={titleId}
    >
      <div className="g-item-media">
        {it.photoUrl ? (
          <img src={assetUrl(it.photoUrl)} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="g-item-placeholder" aria-hidden="true">🎁</div>
        )}
        {statusLabel && (
          <span className={`g-status g-status-${shownStatus}`} role="status">
            {statusIcon}
            {statusLabel}
          </span>
        )}
        <span className="g-kind">{it.kind === "physical" ? t("bid.physical") : t("bid.voucher")}</span>
      </div>
      <div className="g-item-body">
        <h2 id={titleId}>{it.title}</h2>
        {it.sponsor && (
          <p className="g-sponsor">
            {it.sponsor.logoUrl && <img className="g-sponsor-logo" src={assetUrl(it.sponsor.logoUrl)} alt="" loading="lazy" />}
            <span>{t("bid.donatedBy", { name: it.sponsor.name })}</span>
          </p>
        )}
        {description ? <p className="g-desc">{description}</p> : null}
        {it.retailValue != null && it.retailValue > 0 ? (
          <p className="g-value">{t("bid.value", { value: fmt(it.retailValue) })}</p>
        ) : null}
        {fixed ? (
          <div className="g-price">
            <div>
              <span className="g-price-label">{t("bid.fixedPrice")}</span>
              <strong className="g-price-value">{fmt(it.buyNow!)}</strong>
            </div>
          </div>
        ) : (
          <div className="g-price">
            <div>
              <span className="g-price-label">{it.bidCount ? t(closed || sold ? "bid.winningBid" : "bid.current") : t("bid.starting")}</span>
              <strong className="g-price-value">{fmt(it.bidCount ? it.highBid : it.startingBid)}</strong>
            </div>
            <span className="g-price-meta">
              {it.bidCount ? plural("bid.oneBid", "bid.bids", it.bidCount) : t("bid.noBids")}
              {it.bidCount && it.highBidder && !sold ? ` · ${it.highBidder}` : ""}
            </span>
          </div>
        )}

        {sold ? (
          <p className={`g-done-label${status === "winning" ? " is-won" : ""}`}>
            {status === "winning" ? t("bid.yoursDone") : fixed ? t("bid.soldShort") : t("bid.soldBuyNow")}
          </p>
        ) : closed ? (
          <p className={`g-done-label${status === "winning" ? " is-won" : ""}`}>
            {status === "winning" ? t("bid.closedWon") : status === "outbid" ? t("bid.closedLost") : t("bid.closed")}
          </p>
        ) : (
          <div className="g-actions">
            {!buyNowOnly && (
              <div className="g-stepper" role="group" aria-label={it.title}>
                <button
                  type="button"
                  className="g-step"
                  aria-label={t("bid.less")}
                  disabled={!open || busy || !canStepDown(amount, it)}
                  onClick={() => onStep(it.id, -1)}
                >
                  −
                </button>
                <button
                  type="button"
                  className={`g-bid${isBuyNow ? " is-buynow" : ""}`}
                  disabled={!open || busy}
                  aria-busy={busy}
                  onClick={() => onBid(it, amount)}
                >
                  {busy ? t("bid.sending") : !open ? t("bid.notOpen") : isBuyNow ? t("bid.buyNow", { amount: fmt(amount) }) : t("bid.button", { amount: fmt(amount) })}
                </button>
                <button
                  type="button"
                  className="g-step"
                  aria-label={t("bid.more")}
                  disabled={!open || busy || !canStepUp(amount, it)}
                  onClick={() => onStep(it.id, 1)}
                >
                  +
                </button>
              </div>
            )}
            {it.buyNow != null && (buyNowOnly || !isBuyNow) && (
              <button
                type="button"
                className={buyNowOnly ? "g-bid is-buynow" : "g-buynow"}
                disabled={!open || busy}
                onClick={() => onBid(it, it.buyNow!)}
              >
                {busy
                  ? t("bid.sending")
                  : !open
                    ? t("bid.notOpen")
                    : fixed
                      ? t("bid.buyFor", { amount: fmt(it.buyNow) })
                      : buyNowOnly
                        ? t("bid.buyNow", { amount: fmt(it.buyNow) })
                        : t("bid.buyNowAlt", { amount: fmt(it.buyNow) })}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export const ItemCard = memo(ItemCardImpl);
