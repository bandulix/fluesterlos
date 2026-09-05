import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getGuestToken } from "../lib/api";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";

export function BidPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const { live, error, flashKey } = useLive(code);
  const [msg, setMsg] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState(false);
  const [flashTitle, setFlashTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!token) nav(`/e/${code}`, { replace: true });
  }, [token, code, nav]);

  useEffect(() => {
    if (!flashKey || !live) return;
    setFlashTitle(live.recentBids[0]?.itemTitle ?? null);
    setFlash(true);
    const id = window.setTimeout(() => {
      setFlash(false);
      setFlashTitle(null);
    }, 900);
    return () => window.clearTimeout(id);
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function placeBid(itemId: string, minNext: number) {
    setMsg(null);
    const raw = amounts[itemId];
    const amount = raw ? Number(raw) : minNext;
    try {
      await api(`/api/events/${code}/bids`, {
        method: "POST",
        body: JSON.stringify({ itemId, amount }),
      }, token);
      setMsg(`Bid placed: ${amount.toFixed(2)}`);
    } catch (err) {
      const body = (err as Error & { body?: { currentHigh?: number; minNext?: number; outbid?: boolean } }).body;
      if (body?.outbid) {
        setMsg(`Outbid — high is ${body.currentHigh}. Min next ${body.minNext}.`);
      } else {
        setMsg((err as Error).message);
      }
    }
  }

  if (!live) return <p className="muted">Loading live board… {error}</p>;

  return (
    <section className={`stack bid-board${flash ? " bid-flash" : ""}`}>
      <div className="card">
        <h1>{live.event.title}</h1>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
        <p className="row muted">
          <Link to={`/e/${code}/stats`}>Stats</Link>
          <span>Guests {live.stats.guestCount}</span>
          <span>Total high {live.stats.totalHighBids.toFixed(2)}</span>
        </p>
        {msg && <p className="banner">{msg}</p>}
      </div>
      {live.items.map((it) => {
        const minNext = it.bidCount === 0 ? it.startingBid : it.highBid + it.minIncrement;
        const itemFlash = flashTitle === it.title ? " bid-flash" : "";
        return (
          <article className={`card item${itemFlash}`} key={it.id}>
            {it.photoUrl && <img src={it.photoUrl} alt="" className="thumb" />}
            <h2>{it.title}</h2>
            <p>{it.description}</p>
            <p className="high-bid"><strong>High bid:</strong> {it.highBid.toFixed(2)} {it.highBidder ? `(${it.highBidder})` : ""}</p>
            <p className="muted">Min next {minNext.toFixed(2)} · +{it.minIncrement} {it.buyNow != null ? `· buy now ${it.buyNow}` : ""}</p>
            <div className="row">
              <input
                type="number"
                step="0.01"
                placeholder={String(minNext)}
                value={amounts[it.id] ?? ""}
                onChange={(e) => setAmounts((a) => ({ ...a, [it.id]: e.target.value }))}
                disabled={live.event.status !== "open"}
              />
              <button className="button" disabled={live.event.status !== "open"} onClick={() => placeBid(it.id, minNext)}>Bid</button>
              {it.buyNow != null && (
                <button className="button secondary" disabled={live.event.status !== "open"} onClick={() => placeBid(it.id, it.buyNow!)}>Buy now</button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
