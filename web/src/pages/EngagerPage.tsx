import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { formatAmount, parseCurrency } from "../lib/money";
import { assetUrl } from "../lib/api";
import type { Sponsor } from "../lib/api";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";
import { SponsorBadge } from "../components/SponsorBadge";

/** Same-size tile for every sponsor: logo + name, or a styled name-only tile when there is no logo. */
function SponsorTile({ sponsor }: { sponsor: Sponsor }) {
  return (
    <div className={`sponsor-tile${sponsor.logoUrl ? "" : " is-text"}`}>
      {sponsor.logoUrl ? (
        <>
          <span className="sponsor-tile-logo">
            <img src={assetUrl(sponsor.logoUrl)} alt="" />
          </span>
          <span className="sponsor-tile-name">{sponsor.name}</span>
        </>
      ) : (
        <span className="sponsor-tile-word">{sponsor.name}</span>
      )}
    </div>
  );
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function EngagerPage() {
  const { code = "" } = useParams();
  const { live, error, flashKey, lastBid } = useLive(code);
  const [flash, setFlash] = useState(false);
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const items = live?.items ?? [];

  useEffect(() => {
    if (!flashKey) return;
    setFlash(true);
    setFlashItem(lastBid?.itemId ?? null);
    const t = setTimeout(() => {
      setFlash(false);
      setFlashItem(null);
    }, 900);
    return () => clearTimeout(t);
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length]);

  if (!live) return <div className="engager"><p>Loading big screen… {error}</p></div>;
  const ccy = parseCurrency(live.event.currency);
  const money = (n: number) => formatAmount(n, ccy);
  const highlight = items[idx % Math.max(items.length, 1)];
  const joinUrl = live.event.joinUrl;
  const isLive = live.event.status === "open";
  const closed = live.event.status === "closed";
  const sponsors = [...new Map(items.filter((i) => i.sponsor).map((i) => [i.sponsor!.id, i.sponsor!])).values()];

  return (
    <div className={`engager${isLive ? " is-live" : ""}${flash ? " bid-flash" : ""}`}>
      <header>
        <div>
          <h1>{live.event.title}</h1>
          <span className="live-badge">{closed ? "Closed" : "Live"}</span>
        </div>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} timezone={live.event.timezone} closedEarly={live.event.closedEarly} />
      </header>

      <div className="engager-top">
        <section className={`panel totals${flash ? " bid-flash" : ""}`}>
          <p className="muted">{closed ? "Raised" : "Raised so far"}</p>
          <p className="huge">{money(live.stats.totalHighBids)}</p>
          <p className="muted">
            {live.stats.totalBids} {live.stats.totalBids === 1 ? "bid" : "bids"} · {live.stats.guestCount}{" "}
            {live.stats.guestCount === 1 ? "guest" : "guests"}
          </p>
        </section>

        <section className={`panel highlight${flash ? " bid-flash" : ""}`}>
          {highlight ? (
            <div className="highlight-row">
              {highlight.photoUrl && <img className="highlight-photo" src={assetUrl(highlight.photoUrl)} alt="" />}
              <div className="highlight-text">
                <p className="muted">Now featuring</p>
                <h2>{highlight.title}</h2>
                <SponsorBadge sponsor={highlight.sponsor} size="lg" />
                <p className="big-amount">{money(highlight.bidCount ? highlight.highBid : highlight.startingBid)}</p>
                <p className="muted">
                  {highlight.bidCount ? (closed ? `Won by ${highlight.highBidder}` : `Leading: ${highlight.highBidder}`) : `Starting bid · no bids yet`}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted">Add items to spotlight</p>
          )}
        </section>

        {joinUrl && !closed && (
          <section className="panel join-qr">
            <p className="join-qr-title">Scan to bid</p>
            <div className="join-qr-code">
              <QRCodeSVG value={joinUrl} size={220} marginSize={2} level="M" title={`Scan to bid: ${joinUrl}`} />
            </div>
            <p className="join-qr-url">{shortUrl(joinUrl)}</p>
          </section>
        )}
      </div>

      <div className="engager-bottom">
        <section className="panel items-board">
          <h3>{closed ? "Results" : "All items"}</h3>
          <ul className="board-grid">
            {items.map((it) => (
              <li key={it.id} className={`board-item${flashItem === it.id ? " is-flash" : ""}${it.soldViaBuyNow ? " is-sold" : ""}`}>
                {it.photoUrl ? <img src={assetUrl(it.photoUrl)} alt="" /> : <span className="board-thumb" aria-hidden="true">🎁</span>}
                <div>
                  <p className="board-title">{it.title}</p>
                  <p className="board-amount">{money(it.bidCount ? it.highBid : it.startingBid)}</p>
                  <p className="board-meta">
                    {it.soldViaBuyNow
                      ? `Sold · ${it.highBidder}`
                      : it.bidCount
                        ? `${it.highBidder} · ${it.bidCount} ${it.bidCount === 1 ? "bid" : "bids"}`
                        : "Starting bid"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel feed">
          <h3>Latest bids</h3>
          {live.recentBids.length === 0 ? (
            <p className="muted">The first bid will show up here.</p>
          ) : (
            <ul>
              {live.recentBids.slice(0, 7).map((b, i) => (
                <li key={`${b.createdAt}-${i}`} className={i === 0 ? "is-latest" : undefined}>
                  <strong>{money(b.amount)}</strong>
                  <span>
                    {b.itemTitle}
                    <small>{b.guestName}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sponsors.length > 0 && (
        <section className="sponsor-strip">
          <h3>Thank you to our sponsors</h3>
          <div className="sponsor-row">
            {sponsors.map((sp) => (
              <SponsorTile key={sp.id} sponsor={sp} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
