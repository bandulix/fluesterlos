import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getGuestToken } from "../lib/api";
import { formatMoney, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";

export function BidPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const { live, error, flashKey } = useLive(code);
  const [msg, setMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [flashTitle, setFlashTitle] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function placeBid(itemId: string, amount: number) {
    setMsg(null);
    setBusyId(itemId);
    try {
      await api(`/api/events/${code}/bids`, {
        method: "POST",
        body: JSON.stringify({ itemId, amount }),
      }, token);
      setMsg(`You're in at ${formatMoney(amount, parseCurrency(live?.event.currency))}`);
    } catch (err) {
      const body = (err as Error & { body?: { currentHigh?: number; minNext?: number; outbid?: boolean } }).body;
      if (body?.outbid) {
        const ccy = parseCurrency(live?.event.currency);
        setMsg(`Outbid — high is ${formatMoney(Number(body.currentHigh), ccy)}. Next is ${formatMoney(Number(body.minNext), ccy)}.`);
      } else {
        setMsg((err as Error).message);
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!live) return <p className="muted">Loading… {error}</p>;
  const open = live.event.status === "open";
  const ccy = parseCurrency(live.event.currency);

  return (
    <section className={`stack bid-board${flash ? " bid-flash" : ""}`}>
      <header className="bid-head">
        <h1>{live.event.title}</h1>
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
        {live.event.status === "closed" && (
          <p className="banner">
            Closed. <Link to={`/e/${code}/invoice`}>Pay your invoice</Link>
          </p>
        )}
        {msg && <p className="banner">{msg}</p>}
      </header>
      {live.items.map((it) => {
        const minNext = it.bidCount === 0 ? it.startingBid : it.highBid + it.minIncrement;
        const itemFlash = flashTitle === it.title ? " bid-flash" : "";
        return (
          <article className={`card item${itemFlash}`} key={it.id}>
            {it.photoUrl && <img src={it.photoUrl} alt="" className="thumb" />}
            <h2>{it.title}</h2>
            {it.description ? <p>{it.description}</p> : null}
            <p className="high-bid">{formatMoney(it.highBid, ccy)}{it.highBidder ? ` · ${it.highBidder}` : ""}</p>
            <div className="row">
              <button
                className="button"
                disabled={!open || busyId === it.id}
                onClick={() => placeBid(it.id, minNext)}
              >
                {open ? `Bid ${formatMoney(minNext, ccy)}` : "Closed"}
              </button>
              {it.buyNow != null && open && (
                <button
                  className="button secondary"
                  disabled={busyId === it.id}
                  onClick={() => placeBid(it.id, it.buyNow!)}
                >
                  Buy now {formatMoney(it.buyNow, ccy)}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
