import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatAmount, parseCurrency } from "../lib/money";
import { raisedSplit } from "../lib/pledgeLogic";
import { useLive } from "../lib/useLive";
import { BrandMark } from "../components/BrandMark";
import { Countdown } from "../components/Countdown";
import { plural, t } from "../i18n";
import { LangSwitch } from "../guest/LangSwitch";
import "../guest/guest.css";

export function StatsPage() {
  const { code = "" } = useParams();
  const { live, error, flashKey } = useLive(code);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!flashKey) return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 900);
    return () => window.clearTimeout(id);
  }, [flashKey]);

  if (!live) {
    return (
      <p className="muted">
        {t("stats.loading")} {error}
      </p>
    );
  }
  const ccy = parseCurrency(live.event.currency);
  const split = raisedSplit(live.stats);
  const without = live.items.filter((it) => it.bidCount === 0).length;
  return (
    <section className={`stack stats-page${flash ? " bid-flash" : ""}`}>
      <div className="card">
        <LangSwitch />
        <div className="stats-brand">
          <BrandMark />
          <h1>{live.event.title}</h1>
        </div>
        <Countdown
          variant="tiles"
          startsAt={live.event.startsAt}
          endsAt={live.event.endsAt}
          status={live.event.status}
          timezone={live.event.timezone}
          closedEarly={live.event.closedEarly}
          hourLabel={t("time.hrs")}
          minuteLabel={t("time.min")}
          secondLabel={t("time.sec")}
          closedText={t("bid.ended")}
          closedEarlyText={t("bid.closedEarly")}
        />
        <div className="stats-grid">
          <div className="stat">
            <span className="muted">{t("bid.raised")}</span>
            <strong>{formatAmount(split.total, ccy)}</strong>
          </div>
          {live.needs?.length || live.stats.totalDonations ? (
            <div className="stat">
              <span className="muted">{t("stats.split")}</span>
              <strong>
                {formatAmount(split.auction, ccy)} / {formatAmount(split.donations, ccy)}
              </strong>
            </div>
          ) : null}
          <div className="stat">
            <span className="muted">{t("stats.bids")}</span>
            <strong>{live.stats.totalBids}</strong>
          </div>
          <div className="stat">
            <span className="muted">{t("stats.guests")}</span>
            <strong>{live.stats.guestCount}</strong>
          </div>
          <div className="stat">
            <span className="muted">{t("stats.withBids")}</span>
            <strong>
              {live.stats.itemsWithBids ?? live.items.filter((i) => i.bidCount > 0).length} / {live.stats.itemCount}
            </strong>
          </div>
        </div>
        <p className="row">
          <Link to={`/e/${code}/bid`}>{t("stats.openBid")}</Link>
        </p>
      </div>
      <div className="card">
        <h2>{t("stats.leaders")}</h2>
        <ol>
          {live.items
            .filter((it) => it.bidCount > 0)
            .sort((a, b) => b.highBid - a.highBid)
            .map((it) => (
              <li key={it.id}>
                {it.title}: {formatAmount(it.highBid, ccy)} {it.highBidder ? `— ${it.highBidder}` : ""}
              </li>
            ))}
        </ol>
        {without > 0 && <p className="muted">{plural("stats.withoutOne", "stats.without", without)}</p>}
      </div>
      <div className="card">
        <h2>{t("stats.recent")}</h2>
        <ul>
          {live.recentBids.map((b, i) => (
            <li key={i}>{t("stats.line", { name: b.guestName, amount: formatAmount(b.amount, ccy), title: b.itemTitle })}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
