import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, clearGuestToken, getGuestToken, GuestMe, LiveItem, maskPhone } from "../lib/api";
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
import { OutbidBanner } from "../guest/OutbidBanner";
import { useNow } from "../guest/useNow";
import "../guest/guest.css";

type BidError = Error & { body?: { currentHigh?: number; minNext?: number; outbid?: boolean; sold?: boolean } };

const nudgeKey = (code: string) => `fl_name_nudge_${code.toLowerCase()}`;
const prefetchInvoice = () => import("./InvoicePage");

export function BidPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const token = getGuestToken(code);
  const { live, error, flashKey, lastBid, clockOffsetMs } = useLive(code);
  const now = useNow(clockOffsetMs);
  const [me, setMe] = useState<GuestMe | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [outbid, setOutbid] = useState<string | null>(null);
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

  // Auto-hide the outbid banner after a while (it's non-blocking anyway).
  useEffect(() => {
    if (!outbid) return;
    const id = window.setTimeout(() => setOutbid(null), 8000);
    return () => window.clearTimeout(id);
  }, [outbid]);

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
        await loadMe().catch(() => undefined);
      } catch (err) {
        const body = (err as BidError).body;
        if (body?.sold) say(t("bid.sold"));
        else if (body?.outbid && body.minNext != null) {
          say(t("bid.tooLow", { amount: formatAmount(Number(body.minNext), ccy) }));
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
  const hasBid = (me?.bidItemIds?.length ?? 0) > 0;
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
              payHref={eventStatus === "closed" && won.length ? `/e/${code}/invoice` : undefined}
              onChangeName={eventStatus !== "closed" ? () => setEditName(true) : undefined}
              onSwitch={switchUser}
            />
          ) : null
        }
      />

      {outbidItem && outbidVisible && (
        <OutbidBanner
          title={outbidItem.title}
          amountLabel={formatAmount(minNextBid(outbidItem), ccy)}
          onBid={() => onBid(outbidItem, minNextBid(outbidItem))}
          onClose={() => setOutbid(null)}
        />
      )}

      <div className="g-content">
        {eventStatus === "closed" && (
          <div className={`g-result${won.length ? " is-won" : ""}`}>
            {won.length ? (
              <>
                <div>
                  <strong className="g-result-title">🎉 {plural("bid.wonCtaOne", "bid.wonCta", won.length)}</strong>
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

        {(counts.mine > 0 || filter !== "all") && (
          <FilterChips value={filter} counts={counts} closed={eventStatus === "closed"} onChange={setFilter} />
        )}

        <div className="g-items">
          {visible.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              ccy={ccy}
              status={statuses?.[it.id] ?? null}
              eventStatus={eventStatus}
              chosen={chosen[it.id]}
              busy={busyId === it.id}
              highlight={flashId === it.id}
              onStep={onStep}
              onBid={onBid}
            />
          ))}
          {visible.length === 0 && filter !== "all" && (
            <p className="g-empty">{t(eventStatus === "closed" ? `bid.filter.emptyClosed.${filter}` : `bid.filter.empty.${filter}`)}</p>
          )}
        </div>

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
