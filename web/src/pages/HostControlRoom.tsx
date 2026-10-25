import { useState } from "react";
import { Link } from "react-router-dom";
import type { LivePayload } from "../lib/api";
import { formatAmount, type Currency } from "../lib/money";
import { hostNextActions } from "../lib/p2";
import { Countdown } from "../components/Countdown";

/**
 * Host view of the night. It reads the live payload the host page already holds,
 * so the room preview does not open a second connection.
 */
export function HostControlRoom({
  live,
  ccy,
  busy,
  onStartPaddle,
  onNextLevel,
  onCloseLot,
  onCloseAuction,
  confirmClose,
  onCancelClose,
}: {
  live: LivePayload;
  ccy: Currency;
  busy: boolean;
  onStartPaddle: () => void;
  onNextLevel: () => void;
  onCloseLot: (itemId: string) => void;
  onCloseAuction: () => void;
  confirmClose?: boolean;
  onCancelClose?: () => void;
}) {
  const ev = live.event;
  const openLots = live.items.filter((it) => !it.closed && !it.soldViaBuyNow);
  const featured = [...live.items].filter((it) => it.bidCount > 0).sort((a, b) => b.highBid - a.highBid)[0] ?? live.items[0];
  const paddle = live.paddle?.status ?? null;
  const actions = hostNextActions({
    status: ev.status,
    paddle: paddle === "live" || paddle === "paused" || paddle === "ended" ? paddle : "off",
    openLots: openLots.length,
  });
  const [lotId, setLotId] = useState(openLots[0]?.id ?? "");
  const chosen = openLots.some((it) => it.id === lotId) ? lotId : (openLots[0]?.id ?? "");

  return (
    <section className="host-control" aria-label="Control room">
      <div className="host-control-main">
        <p className="host-control-kicker">
          <span className={`live-dot${ev.status === "open" ? " is-on" : ""}`} aria-hidden="true" />
          {ev.status === "open" ? "Live" : ev.status === "scheduled" ? "Not started" : "Closed"}
        </p>
        <Countdown variant="tiles" startsAt={ev.startsAt} endsAt={ev.endsAt} status={ev.status} timezone={ev.timezone} closedEarly={ev.closedEarly} />
        <div className="host-actions">
          {actions.paddle === "start" && (
            <button type="button" className="button" disabled={busy} onClick={onStartPaddle}>Start paddle</button>
          )}
          {actions.paddle === "next" && (
            <button type="button" className="button" disabled={busy || live.paddle?.status === "paused"} onClick={onNextLevel}>
              Next paddle level
            </button>
          )}
          {actions.closeLot && (
            <>
              <label>
                Close lot
                <select value={chosen} onChange={(e) => setLotId(e.target.value)}>
                  {openLots.map((it) => (
                    <option key={it.id} value={it.id}>{it.title}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="button secondary" disabled={busy || !chosen} onClick={() => onCloseLot(chosen)}>
                Close lot
              </button>
            </>
          )}
          {actions.closeAuction && (
            confirmClose ? (
              <>
                <span>Close the auction now? Bidding stops immediately.</span>
                <button type="button" className="button danger" disabled={busy} onClick={onCloseAuction}>
                  Yes, close now
                </button>
                <button type="button" className="button secondary" disabled={busy} onClick={onCancelClose}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="button danger" disabled={busy} onClick={onCloseAuction}>
                Close auction
              </button>
            )
          )}
        </div>
      </div>
      <aside className="host-room-preview" aria-label="Room preview">
        <p className="host-room-title">{ev.title}</p>
        <p className="host-room-status">{ev.status === "open" ? "Live" : ev.status === "closed" ? "Closed" : "Soon"}</p>
        {featured && (
          <p className="host-room-lot">
            <span>{featured.title}</span>
            <strong>{formatAmount(featured.bidCount ? featured.highBid : featured.startingBid, ccy)}</strong>
          </p>
        )}
        {live.paddle && live.paddle.level != null && (
          <p className="host-room-paddle">Paddle {formatAmount(live.paddle.level, ccy)}</p>
        )}
        <Link to={`/e/${ev.code}/engager`}>Open big screen</Link>
      </aside>
    </section>
  );
}
