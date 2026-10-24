import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, clearGuestToken, getGuestToken, GuestMe, LiveItem, maskPhone, Need } from "../lib/api";
import { pledgedNeedIds, pledgeTotal, raisedSplit, recognitionMoves } from "../lib/pledgeLogic";
import { formatAmount, parseCurrency } from "../lib/money";
import { useLive } from "../lib/useLive";
import {
  effectiveAmount,
  filterCounts,
  filterItems,
  FilterKey,
  ItemStatus,
  minNextBid,
  newlyOutbid,
  statusAt,
  statusMap,
  stepAmount,
  vibrate,
  wonItems,
} from "../lib/bidLogic";
import { formatTimeInZone } from "../lib/time";
import { plural, t } from "../i18n";
import { Toast, ToastMessage } from "../components/Toast";
import { GuestHeader } from "../guest/GuestHeader";
import { ItemCard } from "../guest/ItemCard";
import { FilterChips } from "../guest/FilterChips";
import { NameNudge } from "../guest/NameNudge";
import { GuestMenu } from "../guest/GuestMenu";
import { SwitchConfirm } from "../guest/SwitchConfirm";
import { InstallHint } from "../guest/InstallHint";
import { NeedCard, PledgeDraft } from "../guest/NeedCard";
import { RecognitionEditor } from "../guest/RecognitionEditor";
import { TopDonorsList } from "../guest/TopDonors";
import { PaddleCard } from "../guest/PaddleCard";
import { OutbidBanner } from "../guest/OutbidBanner";
import { useNow } from "../guest/useNow";
import "../guest/guest.css";

type BidError = Error & { body?: { currentHigh?: number; minNext?: number; outbid?: boolean; sold?: boolean } };

function agoLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s) || s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const nudgeKey = (code: string) => `fl_name_nudge_${code.toLowerCase()}`;
const prefetchInvoice = () => import("./InvoicePage");

export function BidPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const { live, error, flashKey, lastBid, lastPledge, pledgeKey, clockOffsetMs } = useLive(code);
  const now = useNow(clockOffsetMs);
  const [me, setMe] = useState<GuestMe | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterKey>("all");
  const [category, setCategory] = useState<"auction" | "donate" | "donors">("auction");
  const [rising, setRising] = useState<string[]>([]);
  const prevDonors = useRef<{ name: string; rank: number }[]>([]);
  const donorsSeen = useRef(false);
  const [donateFilter, setDonateFilter] = useState<"all" | "mine">("all");
  const [openNeed, setOpenNeed] = useState<string | null>(null);
  const [fundedId, setFundedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [outbid, setOutbid] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => localStorage.getItem(nudgeKey(code)) === "1");
  const [editName, setEditName] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const prevStatus = useRef<Record<string, ItemStatus> | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  const loadMe = useCallback(async () => {
    const res = await api<GuestMe>(`/api/events/${code}/me`, {}, token);
    if (!res.guest) {
      clearGuestToken(code);
      nav(`/e/${code}`, { replace: true });
      return;
    }
    setMe(res);
  }, [code, token, nav]);

  useEffect(() => {
    if (!token) nav(`/e/${code}`, { replace: true });
    else loadMe().catch(() => undefined);
  }, [token, code, nav, loadMe]);

  // Outbid detection: winning → outbid since the last update.
  const statuses = useMemo(() => (live && me ? statusMap(live.items, me) : null), [live, me]);
  useEffect(() => {
    if (!statuses) return;
    const prev = prevStatus.current;
    prevStatus.current = statuses;
    if (!prev) return;
    const lost = newlyOutbid(prev, statuses);
    if (lost.length) {
      setOutbid(lost[0]);
      vibrate([80, 60, 80]);
    }
  }, [statuses]);

  // Brief highlight of the item that just got a bid.
  useEffect(() => {
    if (!flashKey || !lastBid) return;
    setFlashId(lastBid.itemId);
    const id = window.setTimeout(() => setFlashId(null), 900);
    return () => window.clearTimeout(id);
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventStatus = live ? statusAt(live.event, now) : "scheduled";
  useEffect(() => {
    if (eventStatus !== "closed") return;
    prefetchInvoice().catch(() => undefined);
    setFilter((f) => (f === "mine" ? "all" : f)); // "Mine" isn't offered after the close
    setEditName(false);
  }, [eventStatus]);

  // "✓ Saved" replaces the name form briefly, then folds away.
  useEffect(() => {
    if (!savedName) return;
    const id = window.setTimeout(() => setSavedName(null), 2600);
    return () => window.clearTimeout(id);
  }, [savedName]);

  useEffect(() => {
    const donors = live?.topDonors ?? [];
    if (!donorsSeen.current) {
      donorsSeen.current = true;
      prevDonors.current = donors;
      return;
    }
    const moved = recognitionMoves(prevDonors.current, donors);
    prevDonors.current = donors;
    if (!moved.length) return;
    setRising(moved);
    const id = window.setTimeout(() => setRising([]), 4000);
    return () => window.clearTimeout(id);
  }, [live?.topDonors]);

  useEffect(() => {
    if (!pledgeKey || !lastPledge?.hitTarget) return;
    setFundedId(lastPledge.needId);
    setCategory("donate");
    setOpenNeed(lastPledge.needId);
    const id = window.setTimeout(() => setFundedId(null), 8000);
    return () => window.clearTimeout(id);
  }, [pledgeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const undoPledge = useCallback(
    async (pledgeId: string) => {
      setToast(null);
      try {
        await api(`/api/events/${code}/pledges/${pledgeId}`, { method: "DELETE" }, token);
        say(t("donate.undone"));
        await loadMe().catch(() => undefined);
      } catch (err) {
        const status = (err as { status?: number }).status;
        say(status === 409 || status === 404 ? t("donate.undoLate") : (err as Error).message);
      }
    },
    [code, token, loadMe, say],
  );

  const saveRecognition = useCallback(
    async (draft: { namedPublicly: boolean; publicName: string; showAmount: boolean }) => {
      setBusyId("recognition");
      try {
        await api(`/api/events/${code}/me/recognition`, { method: "PUT", body: JSON.stringify(draft) }, token);
        say(t("donate.recognitionSaved"));
        await loadMe().catch(() => undefined);
      } catch (err) {
        say((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [code, token, loadMe, say],
  );

  const onPledge = useCallback(
    async (need: Need, draft: PledgeDraft) => {
      const ccy = parseCurrency(live?.event.currency);
      setBusyId(need.id);
      try {
        const res = await api<{ pledgeId?: string; undoSeconds?: number; amount: number }>(
          `/api/events/${code}/pledges`,
          { method: "POST", body: JSON.stringify({ needId: need.id, ...draft }) },
          token,
        );
        const amount = res.amount;
        const pledgeId = res.pledgeId;
        const text = t("donate.toast", { amount: formatAmount(amount, ccy), title: need.title });
        setToast(
          pledgeId
            ? { id: Date.now(), text, ms: (res.undoSeconds ?? 10) * 1000, action: { label: t("bid.undo"), onClick: () => undoPledge(pledgeId) } }
            : { id: Date.now(), text },
        );
        vibrate(30);
        await loadMe().catch(() => undefined);
      } catch (err) {
        say((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [code, token, live?.event.currency, loadMe, undoPledge, say],
  );

  const undoBid = useCallback(
    async (bidId: string) => {
      setToast(null);
      try {
        await api(`/api/events/${code}/bids/${bidId}`, { method: "DELETE" }, token);
        say(t("bid.undone"));
        await loadMe().catch(() => undefined);
      } catch (err) {
        const status = (err as { status?: number }).status;
        say(status === 409 || status === 404 ? t("bid.undoTooLate") : (err as Error).message);
      }
    },
    [code, token, loadMe, say],
  );

  const onStep = useCallback(
    (itemId: string, dir: 1 | -1) => {
      const it = live?.items.find((x) => x.id === itemId);
      if (!it) return;
      setChosen((c) => ({ ...c, [itemId]: stepAmount(effectiveAmount(c[itemId], it), dir, it) }));
      setNotice((n) => (n?.id === itemId ? null : n));
    },
    [live],
  );

  const onBid = useCallback(
    async (it: LiveItem, amount: number) => {
      const ccy = parseCurrency(live?.event.currency);
      setBusyId(it.id);
      try {
        const res = await api<{ bidId?: string; undoSeconds?: number }>(
          `/api/events/${code}/bids`,
          { method: "POST", body: JSON.stringify({ itemId: it.id, amount }) },
          token,
        );
        const bought = it.buyNow != null && amount >= it.buyNow;
        const text = bought ? t("bid.boughtNow", { title: it.title }) : t("bid.placedShort", { amount: formatAmount(amount, ccy), title: it.title });
        // Accidental-tap protection without an extra confirm step: a few seconds to take it back.
        const bidId = res.bidId;
        setToast(
          bidId
            ? { id: Date.now(), text, ms: (res.undoSeconds ?? 5) * 1000, action: { label: t("bid.undo"), onClick: () => undoBid(bidId) } }
            : { id: Date.now(), text },
        );
        vibrate(30);
        setChosen((c) => {
          const { [it.id]: _drop, ...rest } = c;
          return rest;
        });
        if (outbid === it.id) setOutbid(null);
        setNotice((n) => (n?.id === it.id ? null : n));
        await loadMe().catch(() => undefined);
      } catch (err) {
        const body = (err as BidError).body;
        if (body?.sold) say(t("bid.sold"));
        else if (body?.outbid && body.minNext != null) {
          const text = t("bid.tooLow", { amount: formatAmount(Number(body.minNext), ccy) });
          setNotice({ id: it.id, text });
          setChosen((c) => ({ ...c, [it.id]: Number(body.minNext) }));
        } else say((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [code, token, live?.event.currency, loadMe, outbid, undoBid, say],
  );

  async function saveName(name: string) {
    const res = await api<{ guest: NonNullable<GuestMe["guest"]> }>(
      `/api/events/${code}/me/name`,
      { method: "PUT", body: JSON.stringify({ name }) },
      token,
    );
    setMe((m) => (m ? { ...m, guest: { ...m.guest!, ...res.guest } } : m));
    setEditName(false);
    setSavedName(res.guest.name);
    // Confirmation as a toast (nothing in the list moves).
    say(t("name.savedInline", { name: res.guest.name }));
  }

  function dismissNudge() {
    localStorage.setItem(nudgeKey(code), "1");
    setNudgeDismissed(true);
  }

  async function switchUser() {
    await api(`/api/events/${code}/logout`, { method: "POST", body: "{}" }).catch(() => undefined);
    clearGuestToken(code);
    nav(`/e/${code}`, { replace: true });
  }

  if (!live) {
    return (
      <section className="g-page">
        <p className="g-loading" role="status">{error ? t("app.retrying") : t("app.loading")}</p>
      </section>
    );
  }

  const ccy = parseCurrency(live.event.currency);
  const counts = filterCounts(live.items, me);
  const visible = filterItems(live.items, filter, me);
  const won = wonItems(live.items, me);
  const needs = live.needs ?? [];
  const myPledgeIds = pledgedNeedIds(me?.pledges);
  const myPledgeSum = pledgeTotal(me?.pledges);
  const raised = raisedSplit(live.stats);
  const showSplit = needs.length > 0 || raised.donations > 0;
  const owes = won.length > 0 || myPledgeSum > 0;
  const hasBid = (me?.bidItemIds?.length ?? 0) > 0 || myPledgeSum > 0;
  const myNeeds = needs.filter((n) => myPledgeIds.includes(n.id));
  const donateNeeds = donateFilter === "mine" ? myNeeds : needs;
  const amountOn = (id: string) => (me?.pledges ?? []).filter((p) => p.needId === id).reduce((s, p) => s + p.amount, 0);
  const recognitionOn = live.event.donorRecognition !== false;
  const guestName = me?.guest?.name ?? "";
  const rec = me?.guest?.recognition;
  const needProps = {
    ccy,
    guestName,
    recognitionOn,
    initialName: rec,
  };
  const showNudge = Boolean(
    me?.guest &&
      eventStatus !== "closed" &&
      !savedName &&
      // The sheet waits until the bid toast (with Undo) is gone, so the two never overlap.
      (editName || (!me.guest.nameSet && !nudgeDismissed && hasBid && toast == null)),
  );
  const outbidItem = outbid ? live.items.find((x) => x.id === outbid) : undefined;
  // Only on the guest's own phone: their name plus the masked tail of their own number.
  const who = me?.guest ? `${me.guest.name}${me.guest.phone ? ` (${maskPhone(me.guest.phone)})` : ""}` : "";
  const outbidVisible = Boolean(outbidItem && eventStatus === "open");

  return (
    <section className={`g-page g-board${showNudge ? " has-sheet" : ""}`}>
      <GuestHeader
        title={live.event.title}
        status={eventStatus}
        startsAt={live.event.startsAt}
        endsAt={live.event.endsAt}
        now={now}
        timezone={live.event.timezone}
        closedEarly={live.event.closedEarly}
        menu={
          me?.guest ? (
            <GuestMenu
              who={who}
              payHref={eventStatus === "closed" && owes ? `/e/${code}/invoice` : undefined}
              onChangeName={eventStatus !== "closed" ? () => setEditName(true) : undefined}
              onSwitch={switchUser}
            />
          ) : null
        }
      />

      {outbidItem && outbidVisible && (
        <OutbidBanner
          title={outbidItem.title}
          amountLabel={formatAmount(outbidItem.bidCount ? outbidItem.highBid : outbidItem.startingBid, ccy)}
          onBid={() => {
            document.getElementById(`item-${outbidItem.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            onBid(outbidItem, minNextBid(outbidItem));
          }}
          onClose={() => setOutbid(null)}
        />
      )}

      <div className="g-content">
        {eventStatus === "closed" && (
          <div className={`g-result${owes ? " is-won" : ""}`}>
            {owes ? (
              <>
                <div>
                  <strong className="g-result-title">
                    {won.length ? `🎉 ${plural("bid.wonCtaOne", "bid.wonCta", won.length)}` : t("bid.pledgesReady")}
                  </strong>
                  <span>{t("bid.thanks")}</span>
                </div>
                <Link to={`/e/${code}/invoice`} className="g-primary g-primary-inline" onMouseEnter={prefetchInvoice}>
                  {t("bid.payNow")}
                </Link>
              </>
            ) : (
              <span>{t("bid.closedNoWin")}</span>
            )}
          </div>
        )}

        {eventStatus === "scheduled" && (
          <p className="g-info">{t("bid.notStarted", { time: formatTimeInZone(live.event.startsAt, live.event.timezone || "Asia/Bangkok") })}</p>
        )}

        {showNudge && me?.guest && (
          <NameNudge
            sheet
            currentName={me.guest.name}
            onSave={saveName}
            autoFocus={editName}
            onDismiss={() => (editName ? setEditName(false) : dismissNudge())}
          />
        )}

        {live.paddle && live.paddle.status !== "ended" && (
          <PaddleCard
            paddle={live.paddle}
            ccy={ccy}
            busy={busyId === "paddle"}
            onRaise={() => {
              const ccyNow = parseCurrency(live.event.currency);
              setBusyId("paddle");
              api<{ pledgeId?: string; undoSeconds?: number; amount: number }>(
                `/api/events/${code}/paddle`,
                { method: "POST", body: "{}" },
                token,
              )
                .then((res) => {
                  const text = t("paddle.toast", { amount: formatAmount(res.amount, ccyNow) });
                  setToast(
                    res.pledgeId
                      ? { id: Date.now(), text, ms: (res.undoSeconds ?? 10) * 1000, action: { label: t("bid.undo"), onClick: () => undoPledge(res.pledgeId!) } }
                      : { id: Date.now(), text },
                  );
                  vibrate(30);
                  return loadMe();
                })
                .catch((err) => say((err as Error).message))
                .finally(() => setBusyId(null));
            }}
          />
        )}

        <div className="g-switch" role="tablist" aria-label={t("cat.label")}>
          <button type="button" role="tab" aria-selected={category === "auction"} className={category === "auction" ? "is-active" : ""} onClick={() => setCategory("auction")}>
            {t("cat.auction")}
          </button>
          <button type="button" role="tab" aria-selected={category === "donate"} className={category === "donate" ? "is-active" : ""} onClick={() => setCategory("donate")}>
            {t("cat.donate")}
          </button>
          {recognitionOn && (
            <button type="button" role="tab" aria-selected={category === "donors"} className={category === "donors" ? "is-active" : ""} onClick={() => setCategory("donors")}>
              {t("cat.donors")}
            </button>
          )}
        </div>

        {(eventStatus === "open" || showSplit) && (
          <div className="g-raised">
            <span className="g-price-label">{t("bid.raised")}</span>
            <strong>{formatAmount(showSplit ? raised.total : live.stats.totalHighBids, ccy)}</strong>
            <span className="g-muted">
              {showSplit
                ? t("bid.raisedSplit", { auction: formatAmount(raised.auction, ccy), donations: formatAmount(raised.donations, ccy) })
                : t("bid.raisedCaption", {
                    bids: plural("bid.oneBid", "bid.bids", live.stats.totalBids),
                    lots: plural("bid.oneLot", "bid.lots", live.stats.itemCount),
                  })}
            </span>
          </div>
        )}

        {category === "auction" && (counts.mine > 0 || myNeeds.length > 0 || filter !== "all") && (
          <FilterChips value={filter} counts={counts} closed={eventStatus === "closed"} onChange={setFilter} />
        )}

        {category === "donate" && (
          <div className="g-chips" role="tablist" aria-label={t("donate.section")}>
            <button type="button" className={`g-chip${donateFilter === "all" ? " is-active" : ""}`} onClick={() => setDonateFilter("all")}>
              {t("donate.filter.all")}
            </button>
            <button type="button" className={`g-chip${donateFilter === "mine" ? " is-active" : ""}`} onClick={() => setDonateFilter("mine")}>
              {t("donate.filter.mine")}
              {myNeeds.length > 0 && <span className="g-chip-count">{myNeeds.length}</span>}
            </button>
          </div>
        )}

        <p className="g-section">
          <span aria-hidden="true">★</span> {category === "donors" ? t("donate.topTitle") : category === "donate" ? t("donate.section") : t("bid.sectionLots")} <span aria-hidden="true">★</span>
        </p>

        {category === "donors" && recognitionOn && (
          <TopDonorsList donors={live.topDonors ?? []} ccy={ccy} rising={rising} />
        )}

        {category === "donate" && (
          <div className="g-items">
            {donateFilter === "mine" && recognitionOn && rec && (
              <RecognitionEditor
                key={`${rec.namedPublicly}|${rec.publicName}|${rec.showAmount}|${rec.hiddenByHost}`}
                guestName={guestName}
                namedPublicly={rec.namedPublicly}
                publicName={rec.publicName}
                showAmount={rec.showAmount}
                hiddenByHost={rec.hiddenByHost}
                busy={busyId === "recognition"}
                onSave={saveRecognition}
              />
            )}
            {donateNeeds.map((n) => (
              <NeedCard
                key={n.id}
                need={n}
                {...needProps}
                expanded={openNeed === n.id}
                busy={busyId === n.id}
                myAmount={amountOn(n.id)}
                justFunded={fundedId === n.id}
                onToggle={() => setOpenNeed((id) => (id === n.id ? null : n.id))}
                onPledge={(draft) => onPledge(n, draft)}
              />
            ))}
            {donateNeeds.length === 0 && (
              <p className="g-empty">{donateFilter === "mine" ? t("donate.filter.empty") : t("donate.empty")}</p>
            )}
          </div>
        )}

        {category === "auction" && <div className="g-items">
          {visible.map((it) => {
            const lead = live.recentBids.find((b) => b.itemId === it.id);
            const ago = lead ? agoLabel(lead.createdAt, now) : null;
            const ends = Date.parse(live.event.endsAt);
            const remaining = ends - now;
            return (
              <ItemCard
                key={it.id}
                item={it}
                ccy={ccy}
                status={statuses?.[it.id] ?? null}
                eventStatus={eventStatus}
                chosen={chosen[it.id]}
                busy={busyId === it.id}
                highlight={flashId === it.id}
                notice={notice?.id === it.id ? notice.text : null}
                leadAgo={ago}
                finalFive={eventStatus === "open" && remaining > 0 && remaining <= 5 * 60_000}
                remainingMs={remaining}
                onStep={onStep}
                onBid={onBid}
              />
            );
          })}
          {visible.length === 0 && filter !== "all" && !(filter === "mine" && myNeeds.length > 0) && (
            <p className="g-empty">{t(eventStatus === "closed" ? `bid.filter.emptyClosed.${filter}` : `bid.filter.empty.${filter}`)}</p>
          )}
          {filter === "mine" && myNeeds.length > 0 && (
            <>
              <p className="g-section">{t("donate.mine")}</p>
              {recognitionOn && rec && (
                <RecognitionEditor
                  key={`${rec.namedPublicly}|${rec.publicName}|${rec.showAmount}|${rec.hiddenByHost}`}
                  guestName={guestName}
                  namedPublicly={rec.namedPublicly}
                  publicName={rec.publicName}
                  showAmount={rec.showAmount}
                  hiddenByHost={rec.hiddenByHost}
                  busy={busyId === "recognition"}
                  onSave={saveRecognition}
                />
              )}
              {myNeeds.map((n) => (
                <NeedCard
                  key={n.id}
                  need={n}
                  {...needProps}
                  expanded={openNeed === n.id}
                  busy={busyId === n.id}
                  myAmount={amountOn(n.id)}
                  justFunded={fundedId === n.id}
                  onToggle={() => setOpenNeed((id) => (id === n.id ? null : n.id))}
                  onPledge={(draft) => onPledge(n, draft)}
                />
              ))}
            </>
          )}
        </div>}

        {me?.guest &&
          (confirmSwitch ? (
            <SwitchConfirm onYes={switchUser} onNo={() => setConfirmSwitch(false)} />
          ) : (
            <p className="g-footer">
              {t("bid.bidAs", { name: who })} ·{" "}
              <button type="button" className="g-link" onClick={() => setConfirmSwitch(true)}>
                {t("bid.switch")}
              </button>
            </p>
          ))}
      </div>

      {eventStatus !== "closed" && !showNudge && <InstallHint hasBid={hasBid} suppressed={outbidVisible || toast != null} />}
      <Toast toast={toast} onDone={clearToast} ms={2200} />
    </section>
  );
}
