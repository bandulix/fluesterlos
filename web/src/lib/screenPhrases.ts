import { countLabel, guestLabel, translate, type Lang } from "../i18n";
import type { LiveItem, Need, RecentPledge } from "./api";
import { isFixedPrice } from "./bidLogic";

export function fundedPhrase(lang: Lang, n: Pick<Need, "percent" | "fullyFunded" | "overFunded">): string {
  const shown = Number.isInteger(n.percent) ? String(n.percent) : n.percent.toFixed(1);
  const pct = translate(lang, "donate.percent", { n: shown });
  if (n.overFunded) return `${translate(lang, "screen.fully")} · ${pct}`;
  if (n.fullyFunded) return translate(lang, "screen.fully");
  return pct;
}

export function spotLabel(lang: Lang, it: LiveItem, closed: boolean): string {
  if (it.soldViaBuyNow) return translate(lang, isFixedPrice(it) ? "screen.soldFixed" : "screen.soldBuyNow");
  if (it.bidCount > 0) return translate(lang, closed ? "screen.soldFor" : "screen.current");
  if (isFixedPrice(it)) return translate(lang, "screen.fixed");
  return translate(lang, "screen.starting");
}

export function spotAmount(it: LiveItem): number {
  if (it.soldViaBuyNow || it.bidCount > 0) return it.highBid;
  if (isFixedPrice(it)) return it.buyNow!;
  return it.startingBid;
}

export function spotSub(lang: Lang, it: LiveItem, closed: boolean): string {
  const bids = countLabel(lang, "bid.oneBid", "bid.bids", it.bidCount);
  if (it.soldViaBuyNow) {
    return it.highBidder ? translate(lang, "screen.boughtBy", { name: it.highBidder }) : translate(lang, "screen.sold");
  }
  if (it.bidCount > 0) {
    const who = closed
      ? translate(lang, "screen.wonBy", { name: it.highBidder ?? "—" })
      : translate(lang, "screen.leading", { name: it.highBidder ?? "—" });
    return `${who} · ${bids}`;
  }
  if (isFixedPrice(it)) return translate(lang, closed ? "screen.notSold" : "screen.buyNowHint");
  return translate(lang, closed ? "screen.noBidsClosed" : "screen.beFirst");
}

export function cardMeta(lang: Lang, it: LiveItem): string {
  if (it.soldViaBuyNow) {
    return it.highBidder ? `${translate(lang, "screen.sold")} · ${it.highBidder}` : translate(lang, "screen.sold");
  }
  if (isFixedPrice(it)) return translate(lang, "screen.fixed");
  if (it.bidCount) return `${it.highBidder ?? "—"} · ${countLabel(lang, "bid.oneBid", "bid.bids", it.bidCount)}`;
  return translate(lang, "screen.starting");
}

export function pledgeLine(lang: Lang, p: RecentPledge, money: (n: number) => string): string {
  const name = guestLabel(p.guestName, lang, p.anonymous);
  if (p.units && p.unitLabel) return translate(lang, "screen.fundedUnits", { name, n: p.units, unit: p.unitLabel });
  return translate(lang, "screen.pledged", { name, amount: money(p.amount) });
}
