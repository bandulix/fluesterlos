import type { LiveItem } from "./api";
import { isFixedPrice } from "./bidLogic";
import { Currency, formatAmount } from "./money";

/** Host item list: "Starting ฿2,000 · no bids", "High ฿2,400 · 3 bids", "Sold ฿3,000 (buy now)", "Fixed price ฿3,000", "Sold at fixed price ฿3,000". */
export function hostPriceLine(
  it: Pick<LiveItem, "soldViaBuyNow" | "highBid" | "buyNow" | "startingBid" | "bidCount">,
  ccy: Currency,
): string {
  if (it.soldViaBuyNow) return isFixedPrice(it) ? `Sold at fixed price ${formatAmount(it.highBid, ccy)}` : `Sold ${formatAmount(it.highBid, ccy)} (buy now)`;
  if (isFixedPrice(it)) return `Fixed price ${formatAmount(it.buyNow!, ccy)}`;
  if (!it.bidCount) return `Starting ${formatAmount(it.startingBid, ccy)} · no bids`;
  return `High ${formatAmount(it.highBid, ccy)} · ${it.bidCount} bid${it.bidCount === 1 ? "" : "s"}`;
}
