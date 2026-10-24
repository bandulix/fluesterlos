import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { formatAmount, parseCurrency } from "../lib/money";
import { assetUrl } from "../lib/api";
import type { Need, Sponsor } from "../lib/api";
import { useLive } from "../lib/useLive";
import { bigScreenFrame, raisedSplit, recognitionMoves } from "../lib/pledgeLogic";
import { auctionClock } from "../lib/auctionClock";
import { AuctionClock } from "../components/AuctionClock";
import { BrandMark } from "../components/BrandMark";
import { SponsorBadge } from "../components/SponsorBadge";
import { isFixedPrice } from "../lib/bidLogic";
import { BOARD_PAGE_MS, chunk, gridFit, hotItemIds, pageCount, pageSlice, spotlightAt } from "../lib/bigScreen";
import { asScreenLang, countLabel, translate, type ScreenLang } from "../i18n";
import { Dual, Line } from "../components/ScreenLine";
import { cardMeta, fundedPhrase, pledgeLine, spotAmount, spotLabel, spotSub } from "../lib/screenPhrases";

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
function SponsorStrip({ sponsors, reduceMotion, screenLang }: { sponsors: Sponsor[]; reduceMotion: boolean; screenLang: ScreenLang }) {
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
    <section className={`sponsor-strip is-${mode}`} aria-label={translate(screenLang === "both" ? "en" : screenLang, "screen.sponsors")}>
      <h3><Line mode={screenLang} k="screen.sponsorThanks" /></h3>
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

function NeedSpotlight({ need, money, spotlight, screenLang }: { need: Need; money: (n: number) => string; spotlight: boolean; screenLang: ScreenLang }) {
  const progress = (lang: "en" | "th" | "de") =>
    `${fundedPhrase(lang, need)} · ${translate(lang, "screen.of", { amount: money(need.targetAmount) })} · ${countLabel(lang, "screen.oneDonor", "screen.donors", need.donorCount)}`;
  return (
    <div className="need-spot">
      {need.photoUrl ? <img className="highlight-photo" src={assetUrl(need.photoUrl)} alt="" /> : <span className="board-thumb need-spot-gift" aria-hidden="true">🎁</span>}
      <div>
        <p className="muted">{spotlight ? <Line mode={screenLang} k="screen.fundSpot" /> : <Line mode={screenLang} k="screen.fund" />}</p>
        <h2>{need.title}</h2>
        {need.example && <p className="example-flag"><Line mode={screenLang} k="screen.example" /></p>}
        <p className="muted">{need.beneficiary}</p>
        <div className="need-bar" role="progressbar" aria-valuenow={Math.round(need.barPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={progress(screenLang === "de" ? "de" : "en")}>
          <span style={{ width: `${need.barPercent}%` }} />
        </div>
        <p className="big-amount">{money(need.raised)}</p>
        <p className="muted spot-sub">
          <Dual mode={screenLang} text={progress} />
        </p>
      </div>
    </div>
  );
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function EngagerPage() {
  const { code = "" } = useParams();
  const { live, error, flashKey, lastBid, lastPledge, pledgeKey, clockOffsetMs } = useLive(code);
  const reduceMotion = usePrefersReducedMotion();
  const [flash, setFlash] = useState(false);
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [glowItem, setGlowItem] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  /** Item that just got a bid: shown in the spotlight until the next rotation. */
  const [pinned, setPinned] = useState<string | null>(null);
  const [pinNeeds, setPinNeeds] = useState(false);
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [clockTick, setClockTick] = useState(0);
  const [rising, setRising] = useState<string[]>([]);
  const prevDonors = useRef<{ name: string; rank: number }[]>([]);
  const donorsSeen = useRef(false);
  const [boardRef, boardSize] = useSize<HTMLDivElement>();
  const items = useMemo(() => live?.items ?? [], [live]);

  useEffect(() => {
    if (!flashKey) return;
    setFlash(true);
    const itemId = lastBid?.itemId ?? null;
    setFlashItem(itemId);
    setGlowItem(itemId);
    // A new bid puts that item in the spotlight right away (for a full rotation slot).
    if (itemId) setPinned(itemId);
    const t = setTimeout(() => {
      setFlash(false);
      setFlashItem(null);
    }, 900);
    const glow = setTimeout(() => setGlowItem(null), 3000);
    return () => {
      clearTimeout(t);
      clearTimeout(glow);
    };
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pledgeKey || !lastPledge) return;
    setPinNeeds(true);
    if (lastPledge.hitTarget) setCelebrateId(lastPledge.needId);
    const clear = window.setTimeout(() => setCelebrateId(null), reduceMotion ? 4000 : 8000);
    return () => window.clearTimeout(clear);
  }, [pledgeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (items.length === 0 && (live?.needs?.length ?? 0) === 0) return;
    const id = setInterval(() => {
      setPinned(null);
      setPinNeeds(false);
      setStep((s) => s + 1);
    }, SPOTLIGHT_MS);
    return () => clearInterval(id);
  }, [items.length, live?.needs?.length, pinned, pinNeeds]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const donors = live?.topDonors ?? [];
    if (!donorsSeen.current) {
      donorsSeen.current = Boolean(live);
      if (live) prevDonors.current = donors;
      return;
    }
    const moved = recognitionMoves(prevDonors.current, donors);
    prevDonors.current = donors;
    if (!moved.length) return;
    setRising(moved);
    const id = window.setTimeout(() => setRising([]), reduceMotion ? 0 : 4500);
    return () => window.clearTimeout(id);
  }, [live, reduceMotion]);

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
  const rankOf = useMemo(() => {
    const top = [...items].filter((it) => it.bidCount > 0 && !it.soldViaBuyNow).sort((a, b) => b.highBid - a.highBid || a.sortOrder - b.sortOrder).slice(0, 3);
    return new Map(top.map((it, i) => [it.id, i + 1]));
  }, [items]);

  const screenLang = asScreenLang(live?.event.screenLanguage);
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.lang;
    const had = root.dataset.screenLang;
    root.dataset.screenLang = "1";
    root.lang = screenLang === "th" ? "th" : screenLang === "de" ? "de" : "en";
    return () => {
      root.lang = prev;
      if (!had) delete root.dataset.screenLang;
    };
  }, [screenLang]);

  if (!live) return <div className="engager"><p><Line mode={screenLang} k="screen.loading" /> {error}</p></div>;
  const ccy = parseCurrency(live.event.currency);
  const money = (n: number) => formatAmount(n, ccy);
  const joinUrl = live.event.joinUrl;
  const isLive = live.event.status === "open";
  const closed = live.event.status === "closed";
  const needs = live.needs ?? [];
  const spotlightNeed = needs.find((n) => n.id === live.event.spotlightNeedId) ?? null;
  const donorsOn = live.event.donorRecognition !== false && live.event.topDonorsOnScreen !== false;
  const spotlightDonors = Boolean(live.event.spotlightTopDonors) && live.event.donorRecognition !== false;
  const frame = bigScreenFrame(step, needs.length, Boolean(spotlightNeed), pinNeeds, donorsOn, spotlightDonors);
  const topDonors = live.topDonors ?? [];
  const serverNow = Date.now() + clockOffsetMs + clockTick * 0;
  const clock = auctionClock({
    status: live.event.status,
    startsAt: live.event.startsAt,
    endsAt: live.event.endsAt,
    now: serverNow,
    closedEarly: live.event.closedEarly,
  });
  const featuredNeed = spotlightNeed ?? (needs.length ? needs[step % needs.length] : null);
  const raised = raisedSplit(live.stats);
  const showSplit = needs.length > 0 || raised.donations > 0;
  const celebrate = needs.find((n) => n.id === celebrateId) ?? null;
  const ticker = live.recentPledges ?? [];
  const highlight = (pinned && items.find((it) => it.id === pinned)) || spotlightAt(step, items, live.recentBids);
  const sponsors = [...new Map(items.filter((i) => i.sponsor).map((i) => [i.sponsor!.id, i.sponsor!])).values()];
  const curPage = page % pages;
  const shown = boardSize.w ? pageSlice(items, curPage, fit.perPage) : [];
  const pageLabel = (lang: "en" | "th" | "de") => translate(lang, "screen.page", { n: curPage + 1, m: pages });

  return (
    <div className={`engager lang-${screenLang}${isLive ? " is-live" : ""}${flash ? " bid-flash" : ""}${reduceMotion ? " reduce-motion" : ""}${spotlightNeed ? " is-spotlight" : ""}`}>
      <header>
        <div>
          <BrandMark />
          <h1>
            <span className="star" aria-hidden="true">★</span>
            <span className="engager-title">{live.event.title}</span>
            <span className="star" aria-hidden="true">★</span>
          </h1>
          <span className="live-badge">{closed ? <Line mode={screenLang} k="screen.closed" /> : <Line mode={screenLang} k="screen.live" />}</span>
        </div>
      </header>

      <AuctionClock
        startsAt={live.event.startsAt}
        endsAt={live.event.endsAt}
        status={live.event.status}
        closedEarly={live.event.closedEarly}
        needsEndsAt={live.event.needsEndsAt}
        timezone={live.event.timezone}
        now={serverNow}
        reduceMotion={reduceMotion}
        screenLang={screenLang}
      />

      {clock.takeover ? (
        <div className={`auction-takeover${reduceMotion ? " is-still" : ""}`} role="timer" aria-label={`${clock.seconds}`}>
          <p className="auction-clock-kicker"><Line mode={screenLang} k="screen.final" /></p>
          <p className="auction-seconds">{clock.seconds}</p>
        </div>
      ) : (
      <div className="engager-main">
      <div className="engager-top">
        <section className={`panel totals${flash ? " bid-flash" : ""}`}>
          <p className="muted">{closed ? <Line mode={screenLang} k="screen.raisedClosed" /> : <Line mode={screenLang} k="screen.raised" />}</p>
          <p className="huge">{money(showSplit ? raised.total : live.stats.totalHighBids)}</p>
          {showSplit && (
            <p className="muted">
              <Line mode={screenLang} k="screen.split" vars={{ auction: money(raised.auction), donations: money(raised.donations) }} />
            </p>
          )}
          <p className="muted">
            <Dual
              mode={screenLang}
              text={(lang) => translate(lang, "screen.from", {
                bids: countLabel(lang, "bid.oneBid", "bid.bids", live.stats.totalBids),
                lots: countLabel(lang, "bid.oneLot", "bid.lots", live.stats.itemCount),
              })}
            />
            {raised.donations > 0 && (
              <>
                {" · "}
                <Dual mode={screenLang} text={(lang) => countLabel(lang, "screen.oneDonor", "screen.donors", live.stats.donorCount ?? 0)} />
              </>
            )}
          </p>
        </section>

        <section className={`panel highlight${flash ? " bid-flash" : ""}${frame === "needs" ? " is-need" : ""}${frame === "donors" ? " is-donors" : ""}`}>
          {frame === "donors" ? (
            <div className="donor-spot">
              <p className="muted">{spotlightDonors ? <Line mode={screenLang} k="screen.donorsSpot" /> : <Line mode={screenLang} k="screen.topDonors" />}</p>
              {topDonors[0] ? (
                <>
                  <h2 className={rising.includes(topDonors[0].name) ? "is-rise" : ""}>{topDonors[0].name}</h2>
                  {topDonors[0].amount != null && <p className="big-amount">{money(topDonors[0].amount)}</p>}
                  <p className="muted spot-sub"><Line mode={screenLang} k="screen.largest" /></p>
                </>
              ) : (
                <p className="muted"><Line mode={screenLang} k="screen.topEmpty" /></p>
              )}
            </div>
          ) : frame === "needs" && featuredNeed ? (
            <NeedSpotlight need={featuredNeed} money={money} spotlight={Boolean(spotlightNeed)} screenLang={screenLang} />
          ) : highlight ? (
            <div className="highlight-row">
              {highlight.photoUrl && <img className="highlight-photo" src={assetUrl(highlight.photoUrl)} alt="" />}
              <div className="highlight-text">
                <p className="muted">{hot.includes(highlight.id) ? <>🔥 <Line mode={screenLang} k="screen.hot" /></> : <Line mode={screenLang} k="screen.featuring" />}</p>
                <h2>{highlight.title}</h2>
                <SponsorBadge sponsor={highlight.sponsor} size="lg" mode={screenLang} />
                <p className="spot-label"><Dual mode={screenLang} text={(lang) => spotLabel(lang, highlight, closed)} /></p>
                <p className="big-amount">{money(spotAmount(highlight))}</p>
                <p className="muted spot-sub"><Dual mode={screenLang} text={(lang) => spotSub(lang, highlight, closed)} /></p>
              </div>
            </div>
          ) : (
            <p className="muted"><Line mode={screenLang} k="screen.addItems" /></p>
          )}
        </section>

        {joinUrl && !closed && (
          <section className="panel join-qr">
            <p className="join-qr-title"><Line mode={screenLang} k="screen.scan" /></p>
            <div className="join-qr-code">
              <QRCodeSVG value={joinUrl} size={220} marginSize={2} level="M" title={`${translate(screenLang === "de" ? "de" : "en", "screen.scan")}: ${joinUrl}`} />
            </div>
            <p className="join-qr-url">{shortUrl(joinUrl)}</p>
          </section>
        )}
      </div>

      {ticker.length > 0 && (
        <div className="pledge-ticker-wrap">
          <div className={`pledge-ticker${reduceMotion ? " is-static" : ""}`} aria-live="polite">
            {(reduceMotion ? ticker.slice(0, 1) : [...ticker, ...ticker]).map((p, i) => (
              <span key={`${p.id}-${i}`}>
                <Dual mode={screenLang} text={(lang) => pledgeLine(lang, p, money)} />
              </span>
            ))}
          </div>
        </div>
      )}

      {celebrate && (
        <div className={`fund-celebrate${reduceMotion ? " is-still" : ""}`} role="status">
          <p><Line mode={screenLang} k="screen.fully" /></p>
          <h2>{celebrate.title}</h2>
          <p className="big-amount">{money(celebrate.raised)}</p>
        </div>
      )}

      <div className="engager-bottom">
        <section className="panel items-board">
          <div className="board-head">
            <h3>
              {frame === "donors" ? <Line mode={screenLang} k="screen.topDonors" /> : frame === "needs" ? <Line mode={screenLang} k="screen.fundBoard" /> : closed ? <Line mode={screenLang} k="screen.results" /> : <Line mode={screenLang} k="screen.allItems" />}{" "}
              <span className="muted">({frame === "donors" ? topDonors.length : frame === "needs" ? needs.length : items.length})</span>
            </h3>
            {frame === "auction" && pages > 1 && (
              <div className="board-pager" aria-label={pageLabel(screenLang === "de" ? "de" : "en")}>
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
          {frame === "donors" ? (
            <ol className="donor-board">
              {topDonors.map((d) => (
                <li key={`${d.rank}-${d.name}`} className={`tier-${d.tier}${rising.includes(d.name) ? " is-rise" : ""}`}>
                  <span className="donor-rank">{d.rank}</span>
                  <span className="donor-name">{d.name}</span>
                  {d.amount != null && <strong>{money(d.amount)}</strong>}
                </li>
              ))}
              {topDonors.length === 0 && <li className="muted"><Line mode={screenLang} k="screen.noDonors" /></li>}
            </ol>
          ) : frame === "needs" ? (
            <ul className="need-board">
              {needs.map((n) => (
                <li key={n.id} className={n.id === featuredNeed?.id ? "is-on" : ""}>
                  <div className="need-board-top">
                    {n.photoUrl ? <img src={assetUrl(n.photoUrl)} alt="" /> : <span className="board-thumb" aria-hidden="true">🎁</span>}
                    <div>
                      <p className="board-title">{n.title}</p>
                      <p className="board-meta">{n.beneficiary}</p>
                    </div>
                    <p className="board-amount">{money(n.raised)}</p>
                  </div>
                  <div className="need-bar" role="progressbar" aria-valuenow={Math.round(n.barPercent)} aria-valuemin={0} aria-valuemax={100} aria-label={fundedPhrase("en", n)}>
                    <span style={{ width: `${n.barPercent}%` }} />
                  </div>
                  <p className="board-meta">
                    <Dual
                      mode={screenLang}
                      text={(lang) => `${fundedPhrase(lang, n)} · ${countLabel(lang, "screen.oneDonor", "screen.donors", n.donorCount)}`}
                    />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
          <ul
            className="board-grid"
            key={reduceMotion ? "static" : `p-${curPage}`}
            style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, gridAutoRows: `${cardH}px`, ["--card-h" as string]: `${cardH}px` }}
          >
            {shown.map((it) => {
              const isHot = hot.includes(it.id);
              const rank = rankOf.get(it.id);
              return (
                <li
                  key={it.id}
                  className={`board-item${flashItem === it.id ? " is-flash" : ""}${glowItem === it.id ? " is-glow" : ""}${it.soldViaBuyNow ? " is-sold" : ""}${isHot ? " is-hot" : ""}`}
                >
                  {rank != null && <span className={`board-rank rank-${rank}`}>{rank}</span>}
                  {it.photoUrl ? <img src={assetUrl(it.photoUrl)} alt="" /> : <span className="board-thumb" aria-hidden="true">🎁</span>}
                  <div>
                    <p className="board-title">
                      {isHot && !rank && <span className="hot-badge"><Line mode={screenLang} k="screen.hotBadge" /></span>}
                      {it.title}
                    </p>
                    <p className="board-amount">{money(it.bidCount ? it.highBid : isFixedPrice(it) ? it.buyNow! : it.startingBid)}</p>
                    <p className="board-meta"><Dual mode={screenLang} text={(lang) => cardMeta(lang, it)} /></p>
                  </div>
                </li>
              );
            })}
          </ul>
          )}
          </div>
        </section>

        <section className="panel feed">
          <h3><Line mode={screenLang} k="screen.latest" /></h3>
          {live.recentBids.length === 0 ? (
            <p className="muted"><Line mode={screenLang} k="screen.firstBid" /></p>
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
      </div>
      )}

      {sponsors.length > 0 && <SponsorStrip sponsors={sponsors} reduceMotion={reduceMotion} screenLang={screenLang} />}
    </div>
  );
}
