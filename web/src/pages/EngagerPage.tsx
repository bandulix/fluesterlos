import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { formatAmount, parseCurrency } from "../lib/money";
import { assetUrl } from "../lib/api";
import type { LiveItem, Sponsor } from "../lib/api";
import { useLive } from "../lib/useLive";
import { Countdown } from "../components/Countdown";
import { SponsorBadge } from "../components/SponsorBadge";
import { isFixedPrice } from "../lib/bidLogic";
import { BOARD_PAGE_MS, chunk, gridFit, hotItemIds, pageCount, pageSlice, spotlightAt, spotlightText } from "../lib/bigScreen";

const CARD_MIN_W = 240;
/** Narrower cards on 1024-wide displays, so a page still holds 8+. */
const CARD_MIN_W_SMALL = 200;
const CARD_H = 84;
const SPOTLIGHT_MS = 6000;
/** Matches the 720p CSS block (max-height: 820px): smaller cards so a page still holds 8+. */
const CARD_H_COMPACT = 66;
const GRID_GAP = 10;
const SPONSOR_PAGE_MS = 6000;

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

/** Element size, kept current with a ResizeObserver (callback ref: works for elements that mount later). */
function useSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}

/** Compact sponsor tile: logo + name in one short row, or a name-only chip. */
function SponsorTile({ sponsor }: { sponsor: Sponsor }) {
  return (
    <div className={`sponsor-tile${sponsor.logoUrl ? "" : " is-text"}`}>
      {sponsor.logoUrl && (
        <span className="sponsor-tile-logo">
          <img src={assetUrl(sponsor.logoUrl)} alt="" />
        </span>
      )}
      <span className="sponsor-tile-name">{sponsor.name}</span>
    </div>
  );
}

/**
 * One row of sponsors, never taller than the strip. If they don't fit: a slow marquee, or — with
 * reduced motion — static pages that change every few seconds.
 */
function SponsorStrip({ sponsors, reduceMotion }: { sponsors: Sponsor[]; reduceMotion: boolean }) {
  const [rowRef, size] = useSize<HTMLDivElement>();
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [perPage, setPerPage] = useState(sponsors.length);
  const [page, setPage] = useState(0);

  useLayoutEffect(() => {
    const m = measureRef.current;
    if (!m || !size.w) return;
    const tiles = Array.from(m.children) as HTMLElement[];
    const total = tiles.reduce((n, t) => n + t.offsetWidth + 16, 0);
    setOverflow(total > size.w);
    const avg = tiles.length ? total / tiles.length : 1;
    setPerPage(Math.max(1, Math.floor(size.w / avg)));
  }, [size.w, sponsors]);

  const pages = chunk(sponsors, perPage);
  useEffect(() => {
    if (!overflow || !reduceMotion || pages.length < 2) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages.length), SPONSOR_PAGE_MS);
    return () => clearInterval(id);
  }, [overflow, reduceMotion, pages.length]);

  const mode = !overflow ? "static" : reduceMotion ? "paged" : "marquee";
  const shown = mode === "paged" ? pages[page % pages.length] ?? [] : sponsors;
  return (
    <section className={`sponsor-strip is-${mode}`} aria-label="Sponsors">
      <h3>Thank you to our sponsors</h3>
      <div className="sponsor-viewport" ref={rowRef}>
        {/* Hidden copy to measure natural widths. */}
        <div className="sponsor-measure" ref={measureRef} aria-hidden="true">
          {sponsors.map((sp) => (
            <SponsorTile key={sp.id} sponsor={sp} />
          ))}
        </div>
        <div className="sponsor-row" style={mode === "marquee" ? { animationDuration: `${Math.max(20, sponsors.length * 3)}s` } : undefined}>
          {shown.map((sp) => (
            <SponsorTile key={sp.id} sponsor={sp} />
          ))}
          {mode === "marquee" &&
            sponsors.map((sp) => (
              <div key={`dup-${sp.id}`} aria-hidden="true" className="sponsor-dup">
                <SponsorTile sponsor={sp} />
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function EngagerPage() {
  const { code = "" } = useParams();
  const { live, error, flashKey, lastBid } = useLive(code);
  const reduceMotion = usePrefersReducedMotion();
  const [flash, setFlash] = useState(false);
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  /** Item that just got a bid: shown in the spotlight until the next rotation. */
  const [pinned, setPinned] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [boardRef, boardSize] = useSize<HTMLDivElement>();
  const items = useMemo(() => live?.items ?? [], [live]);

  useEffect(() => {
    if (!flashKey) return;
    setFlash(true);
    const itemId = lastBid?.itemId ?? null;
    setFlashItem(itemId);
    // A new bid puts that item in the spotlight right away (for a full rotation slot).
    if (itemId) setPinned(itemId);
    const t = setTimeout(() => {
      setFlash(false);
      setFlashItem(null);
    }, 900);
    return () => clearTimeout(t);
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => {
      setPinned(null);
      setStep((s) => s + 1);
    }, SPOTLIGHT_MS);
    return () => clearInterval(id);
  }, [items.length, pinned]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const minCardH = typeof window !== "undefined" && window.innerHeight <= 820 && window.innerWidth > 900 ? CARD_H_COMPACT : CARD_H;
  const minCardW = typeof window !== "undefined" && window.innerWidth < 1200 ? CARD_MIN_W_SMALL : CARD_MIN_W;
  const fit = gridFit(boardSize.w, boardSize.h, minCardW, minCardH, GRID_GAP);
  const cardH = fit.cardH;
  const pages = pageCount(items.length, fit.perPage);
  // One steady 8 s clock for paging. It must not depend on the measured layout: before, every
  // resize of the board (e.g. the spotlight above changing height) restarted the interval, so
  // pages advanced only every 10–15 s.
  useEffect(() => {
    // Paging is how every item gets seen, so it runs with reduced motion too — just without the fade.
    const id = setInterval(() => setPage((p) => p + 1), BOARD_PAGE_MS);
    return () => clearInterval(id);
  }, []);

  const hot = useMemo(() => hotItemIds(items, live?.recentBids ?? [], now), [items, live, now]);

  if (!live) return <div className="engager"><p>Loading big screen… {error}</p></div>;
  const ccy = parseCurrency(live.event.currency);
  const money = (n: number) => formatAmount(n, ccy);
  const joinUrl = live.event.joinUrl;
  const isLive = live.event.status === "open";
  const closed = live.event.status === "closed";
  const highlight = (pinned && items.find((it) => it.id === pinned)) || spotlightAt(step, items, live.recentBids);
  const spot = highlight ? spotlightText(highlight, closed) : null;
  const sponsors = [...new Map(items.filter((i) => i.sponsor).map((i) => [i.sponsor!.id, i.sponsor!])).values()];
  const curPage = page % pages;
  const shown = boardSize.w ? pageSlice(items, curPage, fit.perPage) : [];

  const priceLine = (it: LiveItem) => {
    if (it.soldViaBuyNow) return `Sold · ${it.highBidder}`;
    if (isFixedPrice(it)) return "Fixed price";
    if (it.bidCount) return `${it.highBidder} · ${it.bidCount} ${it.bidCount === 1 ? "bid" : "bids"}`;
    return "Starting bid";
  };

  return (
    <div className={`engager${isLive ? " is-live" : ""}${flash ? " bid-flash" : ""}${reduceMotion ? " reduce-motion" : ""}`}>
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
                <p className="muted">{hot.includes(highlight.id) ? "🔥 Hot right now" : "Now featuring"}</p>
                <h2>{highlight.title}</h2>
                <SponsorBadge sponsor={highlight.sponsor} size="lg" />
                {spot && (
                  <>
                    <p className="spot-label">{spot.label}</p>
                    <p className="big-amount">{money(spot.amount)}</p>
                    <p className="muted spot-sub">{spot.sub}</p>
                  </>
                )}
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
          <div className="board-head">
            <h3>{closed ? "Results" : "All items"} <span className="muted">({items.length})</span></h3>
            {pages > 1 && (
              <div className="board-pager" aria-label={`Page ${curPage + 1} of ${pages}`}>
                <span className="muted">
                  {curPage * fit.perPage + 1}–{Math.min(items.length, (curPage + 1) * fit.perPage)} of {items.length}
                </span>
                <span className="board-dots" aria-hidden="true">
                  {Array.from({ length: pages }, (_, i) => (
                    <i key={i} className={i === curPage ? "is-on" : undefined} />
                  ))}
                </span>
              </div>
            )}
          </div>
          <div className="board-body" ref={boardRef}>
          <ul
            className="board-grid"
            key={reduceMotion ? "static" : `p-${curPage}`}
            style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridAutoRows: `${cardH}px`, ["--card-h" as string]: `${cardH}px` }}
          >
            {shown.map((it) => {
              const isHot = hot.includes(it.id);
              return (
                <li
                  key={it.id}
                  className={`board-item${flashItem === it.id ? " is-flash" : ""}${it.soldViaBuyNow ? " is-sold" : ""}${isHot ? " is-hot" : ""}`}
                >
                  {it.photoUrl ? <img src={assetUrl(it.photoUrl)} alt="" /> : <span className="board-thumb" aria-hidden="true">🎁</span>}
                  <div>
                    <p className="board-title">
                      {isHot && <span className="hot-badge">🔥 Hot</span>}
                      {it.title}
                    </p>
                    <p className="board-amount">{money(it.bidCount ? it.highBid : isFixedPrice(it) ? it.buyNow! : it.startingBid)}</p>
                    <p className="board-meta">{priceLine(it)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
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

      {sponsors.length > 0 && <SponsorStrip sponsors={sponsors} reduceMotion={reduceMotion} />}
    </div>
  );
}
