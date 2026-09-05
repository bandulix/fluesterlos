import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";

export function EngagerPage() {
  const { code = "" } = useParams();
  const { live, error } = useLive(code);
  const [idx, setIdx] = useState(0);
  const items = live?.items ?? [];
  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length]);
  const highlight = items[idx % Math.max(items.length, 1)];
  const joinUrl = live?.event.joinUrl;

  if (!live) return <div className="engager"><p>Loading engager… {error}</p></div>;

  return (
    <div className="engager">
      <header>
        <h1>{live.event.title}</h1>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
      </header>
      <div className="engager-grid">
        <section className="panel totals">
          <p className="muted">Live total (sum of high bids)</p>
          <p className="huge">{live.stats.totalHighBids.toFixed(2)}</p>
          <p>{live.stats.totalBids} bids · {live.stats.guestCount} guests</p>
        </section>
        <section className="panel highlight">
          {highlight ? (
            <>
              <p className="muted">Now featuring</p>
              <h2>{highlight.title}</h2>
              {highlight.photoUrl && <img src={highlight.photoUrl} alt="" />}
              <p className="huge">{highlight.highBid.toFixed(2)}</p>
              <p>{highlight.highBidder ? `High bidder: ${highlight.highBidder}` : "Be the first!"}</p>
            </>
          ) : <p>No items yet</p>}
        </section>
        <section className="panel feed">
          <h3>Recent bids</h3>
          <ul>
            {live.recentBids.slice(0, 8).map((b, i) => (
              <li key={i}><strong>{b.guestName}</strong> → {b.itemTitle} · {b.amount.toFixed(2)}</li>
            ))}
          </ul>
          {joinUrl && <p className="scan">Scan to bid: {joinUrl}</p>}
        </section>
      </div>
    </div>
  );
}
