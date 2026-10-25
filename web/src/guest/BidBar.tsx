import { FormEvent, useState } from "react";
import { t } from "../i18n";
import { formatAmount, type Currency } from "../lib/money";
import { customBidAmount } from "../lib/p2";
import { useBottomBarSpace } from "./useBottomBarSpace";

/** Sticky custom amount and Bid for the live lot. Reserves its own height so it does not cover the list. */
export function BidBar({
  title,
  min,
  ccy,
  busy,
  onBid,
}: {
  title: string;
  min: number;
  ccy: Currency;
  busy: boolean;
  onBid: (amount: number) => void;
}) {
  const ref = useBottomBarSpace<HTMLFormElement>();
  const [raw, setRaw] = useState("");
  const parsed = raw.trim() === "" ? ({ ok: true, amount: min } as const) : customBidAmount(raw, min);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (parsed.ok) onBid(parsed.amount);
  }
  return (
    <form ref={ref} className="g-bidbar" onSubmit={submit}>
      <p className="g-bidbar-title">{title}</p>
      <label className="g-sr" htmlFor="g-custom-bid">{t("bar.custom")}</label>
      <input
        id="g-custom-bid"
        inputMode="decimal"
        placeholder={formatAmount(min, ccy)}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        aria-invalid={!parsed.ok}
      />
      {!parsed.ok && <p className="g-inline-error">{t("bar.tooLow", { amount: formatAmount(min, ccy) })}</p>}
      <button type="submit" className="g-bid" disabled={busy || !parsed.ok}>
        {busy ? t("bid.sending") : t("bar.bid")}
      </button>
    </form>
  );
}
