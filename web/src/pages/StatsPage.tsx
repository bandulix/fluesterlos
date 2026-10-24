import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatAmount, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import { BrandMark } from "../components/BrandMark";
import { Countdown } from "../components/Countdown";

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

  if (!live) return <p className="muted">Loading stats… {error}</p>;
  const ccy = parseCurrency(live.event.currency);
  return (
    <section className={`stack stats-page${flash ? " bid-flash" : ""}`}>
      <div className="card">
        <div className="stats-brand">
          <BrandMark />
          <h1>{live.event.title}</h1>
        </div>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} timezone={live.event.timezone} closedEarly={live.event.closedEarly} />
        <div className="stats-grid">
          <div className="stat"><span className="muted">Raised so far</span><strong>{formatAmount(live.stats.totalHighBids, ccy)}</strong></div>
          <div className="stat"><span className="muted">Bids</span><strong>{live.stats.totalBids}</strong></div>
          <div className="stat"><span className="muted">Guests</span><strong>{live.stats.guestCount}</strong></div>
          <div className="stat"><span className="muted">Items with bids</span><strong>{live.stats.itemsWithBids ?? live.items.filter((i) => i.bidCount > 0).length} / {live.stats.itemCount}</strong></div>
        </div>
        <p className="row"><Link to={`/e/${code}/bid`}>Bid</Link></p>
      </div>
      <div className="card">
        <h2>Leaders</h2>
        <ol>
          {live.items
            .filter((it) => it.bidCount > 0)
            .sort((a, b) => b.highBid - a.highBid)
            .map((it) => (
              <li key={it.id}>{it.title}: {formatAmount(it.highBid, ccy)} {it.highBidder ? `— ${it.highBidder}` : ""}</li>
            ))}
        </ol>
        {live.items.some((it) => it.bidCount === 0) && (
          <p className="muted">{live.items.filter((it) => it.bidCount === 0).length} item(s) without bids yet (not counted in the total).</p>
        )}
      </div>
      <div className="card">
        <h2>Recent bids</h2>
        <ul>
          {live.recentBids.map((b, i) => (
            <li key={i}>{b.guestName} bid {formatAmount(b.amount, ccy)} on {b.itemTitle}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
