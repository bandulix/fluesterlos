import { Link, useParams } from "react-router-dom";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";

export function StatsPage() {
  const { code = "" } = useParams();
  const { live, error } = useLive(code);
  if (!live) return <p className="muted">Loading stats… {error}</p>;
  return (
    <section className="stack">
      <div className="card">
        <h1>Live stats — {live.event.title}</h1>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
        <div className="stats-grid">
          <div><span className="muted">Total high bids</span><strong>{live.stats.totalHighBids.toFixed(2)}</strong></div>
          <div><span className="muted">Bids</span><strong>{live.stats.totalBids}</strong></div>
          <div><span className="muted">Guests</span><strong>{live.stats.guestCount}</strong></div>
          <div><span className="muted">Items</span><strong>{live.stats.itemCount}</strong></div>
        </div>
        <p className="row"><Link to={`/e/${code}`}>Join</Link><Link to={`/e/${code}/engager`}>Engager</Link></p>
      </div>
      <div className="card">
        <h2>Leaders</h2>
        <ol>
          {[...live.items].sort((a, b) => b.highBid - a.highBid).map((it) => (
            <li key={it.id}>{it.title}: {it.highBid.toFixed(2)} {it.highBidder ? `— ${it.highBidder}` : ""}</li>
          ))}
        </ol>
      </div>
      <div className="card">
        <h2>Recent bids</h2>
        <ul>
          {live.recentBids.map((b, i) => (
            <li key={i}>{b.guestName} bid {b.amount.toFixed(2)} on {b.itemTitle}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
