import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatMoney, parseCurrency } from "../lib/money";
import { API_BASE } from "../lib/api";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";
import { SponsorBadge } from "../components/SponsorBadge";

export function EngagerPage() {
  const { code = "" } = useParams();
  const { live, error, flashKey } = useLive(code);
  const [flash, setFlash] = useState(false);
  const [idx, setIdx] = useState(0);
  const items = live?.items ?? [];

  useEffect(() => {
    if (!flashKey) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [flashKey]);

  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length]);

  if (!live) return <div className="engager"><p>Loading engager… {error}</p></div>;
  const ccy = parseCurrency(live.event.currency);
  const highlight = items[idx % Math.max(items.length, 1)];
  const joinUrl = live.event.joinUrl;
  const isLive = live.event.status === "open";
  const sponsors = [...new Map(items.filter((i) => i.sponsor).map((i) => [i.sponsor!.id, i.sponsor!])).values()];

  return (
    <div className={`engager${isLive ? " is-live" : ""}${flash ? " bid-flash" : ""}`}>
      <header>
        <div>
          <h1>{live.event.title}</h1>
          <span className="live-badge">Live</span>
        </div>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
      </header>
      <div className="engager-grid">
        <section className={`panel totals${flash ? " bid-flash" : ""}`}>
          <p className="muted">Live total (sum of high bids)</p>
          <p className="huge">{formatMoney(live.stats.totalHighBids, ccy)}</p>
          <p className="muted">{live.stats.totalBids} bids · {live.stats.guestCount} guests</p>
        </section>
        <section className={`panel highlight${flash ? " bid-flash" : ""}`}>
          {highlight ? (
            <>
              <p className="muted">Now featuring</p>
              <h2>{highlight.title}</h2>
              <SponsorBadge sponsor={highlight.sponsor} size="lg" />
              {highlight.photoUrl && <img src={highlight.photoUrl} alt="" />}
              <p className="huge">{formatMoney(highlight.highBid, ccy)}</p>
              <p className="muted">{highlight.highBidder ? `High: ${highlight.highBidder}` : "Awaiting first bid"}</p>
            </>
          ) : (
            <p className="muted">Add items to spotlight</p>
          )}
        </section>
        <section className="panel feed">
          <h3>Recent bids</h3>
          <ul>
            {live.recentBids.slice(0, 8).map((b, i) => (
              <li key={`${b.createdAt}-${i}`}>
                <strong>{formatMoney(b.amount, ccy)}</strong> · {b.itemTitle} · {b.guestName}
              </li>
            ))}
          </ul>
          {joinUrl && <p className="scan">Scan to bid: {joinUrl}</p>}
          {sponsors.length > 0 && (
            <div className="sponsor-strip">
              <h3>Thank you to our sponsors</h3>
              <div className="row">
                {sponsors.map((sp) =>
                  sp.logoUrl ? (
                    <img key={sp.id} src={`${API_BASE}${sp.logoUrl}`} alt={sp.name} className="sponsor-logo" title={sp.name} />
                  ) : (
                    <span key={sp.id} className="pill">{sp.name}</span>
                  ),
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
