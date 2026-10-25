import { memo } from "react";
import { assetUrl, LiveItem } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";
import { canStepDown, canStepUp, effectiveAmount, formatRemaining, isFixedPrice, ItemStatus, onlyBuyNow } from "../lib/bidLogic";
import { ringState } from "../lib/p2";
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
  /** Thin strip under the stepper when the last bid was too low. */
  notice?: string | null;
  /** "3m ago" for the current leader, when a recent bid is known. */
  leadAgo?: string | null;
  /** Ring for the whole night. The last five minutes turn red. */
  remainingMs?: number;
  totalMs?: number;
  watching?: boolean;
  myMax?: number | null;
  onWatch?: () => void;
  onOpenHistory?: () => void;
  onEditMax?: () => void;
  onCancelMax?: () => void;
};

function TimerRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const { fraction, urgent } = ringState(remainingMs, totalMs);
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span className={`g-ring${urgent ? " is-urgent" : " is-quiet"}`} aria-hidden="true">
      <svg width="48" height="48" viewBox="0 0 40 40">
        <circle className="g-ring-track" cx="20" cy="20" r={r} />
        <circle className="g-ring-value" cx="20" cy="20" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
      </svg>
      <span>{formatRemaining(remainingMs)}</span>
    </span>
  );
}

function ItemCardImpl({
  item: it, ccy, status, eventStatus, chosen, busy, highlight, onStep, onBid, notice, leadAgo,
  remainingMs, totalMs, watching, myMax, onWatch, onOpenHistory, onEditMax, onCancelMax,
}: ItemCardProps) {
  const auctionClosed = eventStatus === "closed";
  const lotClosed = Boolean(it.closed);
  const open = eventStatus === "open" && !lotClosed;
  const closed = auctionClosed;
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
        {eventStatus === "open" && remainingMs != null && totalMs != null && remainingMs > 0 && (
          <TimerRing remainingMs={remainingMs} totalMs={totalMs} />
        )}
        {onWatch && !auctionClosed && (
          <button type="button" className={`g-watch g-watch-badge${watching ? " is-on" : ""}`} aria-pressed={watching} onClick={onWatch}>
            <span aria-hidden="true">{watching ? "★" : "☆"}</span>
            {watching ? t("watch.watching") : t("watch.watch")}
          </button>
        )}
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
              {it.bidCount && it.highBidder && !sold ? <span className="g-leading">{t("bid.leading", { name: it.highBidder })}</span> : null}
            </div>
            {it.bidCount > 0 && onOpenHistory ? (
              <button type="button" className="g-price-meta g-linkish" onClick={onOpenHistory}>
                {plural("bid.oneBid", "bid.bids", it.bidCount)}
              </button>
            ) : (
              <span className="g-price-meta">{it.bidCount ? plural("bid.oneBid", "bid.bids", it.bidCount) : t("bid.noBids")}</span>
            )}
          </div>
        )}
        {!fixed && it.bidCount > 0 && it.highBidder && !sold && !closed && (
          <div className="g-topbid">
            <span>
              <span className="g-price-label">{t("bid.topBid")}</span>
              <span className="g-topbid-who">{it.highBidder}{leadAgo ? ` · ${leadAgo}` : ""}</span>
            </span>
            <strong>{fmt(it.highBid)}</strong>
          </div>
        )}

        {sold ? (
          <p className={`g-done-label${status === "winning" ? " is-won" : ""}`}>
            {status === "winning" ? t("bid.yoursDone") : fixed ? t("bid.soldShort") : t("bid.soldBuyNow")}
          </p>
        ) : lotClosed ? (
          <p className="g-done-label">{t("lot.closed")}</p>
        ) : closed ? (
          <p className={`g-done-label${status === "winning" ? " is-won" : ""}`}>
            {status === "winning" ? t("bid.closedWon") : status === "outbid" ? t("bid.closedLost") : t("bid.closed")}
          </p>
        ) : (
          <div className="g-actions">
            {!buyNowOnly && (
              <>
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
                  <span className="g-step-amount">{fmt(amount)}</span>
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
                {notice ? <p className="g-inline-error" role="alert">{notice}</p> : null}
                {myMax != null && myMax > 0 && (
                  <p className="g-maxline">
                    <span>{t("max.yours", { amount: fmt(myMax) })}</span>
                    <button type="button" onClick={onEditMax}>{t("max.edit")}</button>
                    <button type="button" onClick={onCancelMax}>{t("max.cancel")}</button>
                  </p>
                )}
                <div className="g-bid-row">
                  <button
                    type="button"
                    className={`g-bid${isBuyNow ? " is-buynow" : ""}`}
                    disabled={!open || busy}
                    aria-busy={busy}
                    onClick={() => onBid(it, amount)}
                  >
                    {busy ? t("bid.sending") : !open ? t("bid.notOpen") : isBuyNow ? t("bid.buyNow", { amount: fmt(amount) }) : t("bid.button", { amount: fmt(amount) })}
                  </button>
                </div>
              </>
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
        {open && myMax == null && onEditMax && !fixed && !sold && (
          <button type="button" className="g-max-open" onClick={onEditMax}>{t("max.set")}</button>
        )}
      </div>
    </article>
  );
}

export const ItemCard = memo(ItemCardImpl);
