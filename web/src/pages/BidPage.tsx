import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, clearGuestToken, getGuestToken, GuestMe, LiveItem, maskPhone } from "../lib/api";
import { formatMoney, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";
import { KindPill, SponsorBadge } from "../components/SponsorBadge";

export function BidPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const { live, error, flashKey } = useLive(code);
  const [msg, setMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [flashTitle, setFlashTitle] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [me, setMe] = useState<GuestMe | null>(null);

  const loadMe = useCallback(async () => {
    const res = await api<GuestMe>(`/api/events/${code}/me`, {}, token);
    if (!res.guest) {
      // Token no longer valid for this event: start over at the join page.
      clearGuestToken(code);
      nav(`/e/${code}`, { replace: true });
      return;
    }
    setMe(res);
  }, [code, token, nav]);

  useEffect(() => {
    if (token) loadMe().catch(() => undefined);
  }, [token, loadMe]);

  // Transient feedback only; the per-item status below is the source of truth.
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(id);
  }, [msg]);

  async function logout() {
    await api(`/api/events/${code}/logout`, { method: "POST", body: "{}" }).catch(() => undefined);
    clearGuestToken(code);
    nav(`/e/${code}`, { replace: true });
  }

  function itemStatus(it: LiveItem): "winning" | "outbid" | null {
    if (!me?.leaderKey) return null;
    if (it.leaderKey && it.leaderKey === me.leaderKey) return "winning";
    if (me.bidItemIds?.includes(it.id)) return "outbid";
    return null;
  }

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
      setMsg(`Bid placed: ${formatMoney(amount, parseCurrency(live?.event.currency))}`);
      await loadMe().catch(() => undefined);
    } catch (err) {
      const body = (err as Error & { body?: { currentHigh?: number; minNext?: number; outbid?: boolean; sold?: boolean } }).body;
      if (body?.sold) {
        setMsg("Sorry — this item was just sold via buy now.");
      } else if (body?.outbid) {
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
        {me?.guest && (
          <p className="guest-who">
            <span>
              Bidding as <strong>{me.guest.name}</strong>
              {me.guest.phone ? ` (${maskPhone(me.guest.phone)})` : ""}
            </span>
            <button type="button" className="link-button" onClick={logout}>
              Not you? Log out
            </button>
          </p>
        )}
        <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} timezone={live.event.timezone} closedEarly={live.event.closedEarly} />
        {live.event.status === "closed" && (
          <p className="banner">
            Closed.{" "}
            {live.items.some((it) => itemStatus(it) === "winning") ? (
              <Link to={`/e/${code}/invoice`}>Pay your invoice</Link>
            ) : (
              <Link to={`/e/${code}/invoice`}>See your invoice</Link>
            )}
          </p>
        )}
        {msg && <p className="banner">{msg}</p>}
      </header>
      {live.items.map((it) => {
        const minNext = it.bidCount === 0 ? it.startingBid : it.highBid + it.minIncrement;
        const itemFlash = flashTitle === it.title ? " bid-flash" : "";
        const sold = Boolean(it.soldViaBuyNow);
        // When the next normal bid would reach buy-now, offer only buy-now (it is the cheaper way to win).
        const showBid = !sold && (!open || !(it.buyNow != null && minNext >= it.buyNow));
        const showBuyNow = open && !sold && it.buyNow != null;
        return (
          <article className={`card item${itemFlash}`} key={it.id}>
            {it.photoUrl && <img src={it.photoUrl} alt="" className="thumb" />}
            <h2>{it.title}</h2>
            <SponsorBadge sponsor={it.sponsor} />
            {it.description ? <p>{it.description}</p> : null}
            <KindPill kind={it.kind} />
            <p className="high-bid">{formatMoney(it.highBid, ccy)}{it.highBidder ? ` · ${it.highBidder}` : ""}</p>
            {(() => {
              const st = itemStatus(it);
              if (st === "winning") {
                return (
                  <p className="item-status winning">
                    {open ? "You're winning" : live.event.status === "closed" ? "You won" : "You're the high bidder"}
                  </p>
                );
              }
              if (st === "outbid") {
                return <p className="item-status outbid">{open ? "Outbid — bid again to win" : "Outbid"}</p>;
              }
              return null;
            })()}
            <div className="row">
              {sold && <span className="pill status-closed">Sold (buy now)</span>}
              {showBid && (
                <button
                  className="button"
                  disabled={!open || busyId === it.id}
                  onClick={() => placeBid(it.id, minNext)}
                >
                  {open ? `Bid ${formatMoney(minNext, ccy)}` : "Closed"}
                </button>
              )}
              {showBuyNow && (
                <button
                  className="button secondary"
                  disabled={busyId === it.id}
                  onClick={() => placeBid(it.id, it.buyNow!)}
                >
                  Buy now {formatMoney(it.buyNow!, ccy)}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
