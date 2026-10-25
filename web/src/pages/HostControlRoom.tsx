import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LivePayload } from "../lib/api";
import { formatAmount, type Currency } from "../lib/money";
import { hostNextActions } from "../lib/p2";
import { Countdown } from "../components/Countdown";
import { BrandMark } from "../components/BrandMark";
import { t } from "../i18n";

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
  paddleSetup,
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
  paddleSetup?: ReactNode;
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
  const words = ev.title.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  const lead = words.slice(0, -1).join(" ");
  const statusLabel = ev.status === "open" ? "Live" : ev.status === "scheduled" ? "Not started" : "Closed";
  const primary =
    actions.paddle === "start"
      ? t("paddle.start")
      : actions.paddle === "next"
        ? "Next paddle level"
        : null;

  return (
    <section className="host-control" aria-label="Control room">
      <header className="host-studio-top">
        <p className={`host-studio-live${ev.status === "open" ? " is-on" : ""}`}>
          <span className={`live-dot${ev.status === "open" ? " is-on" : ""}`} aria-hidden="true" />
          {statusLabel}
        </p>
        <Countdown variant="tiles" startsAt={ev.startsAt} endsAt={ev.endsAt} status={ev.status} timezone={ev.timezone} closedEarly={ev.closedEarly} />
        <div className="host-join">
          <span className="host-join-label">Event code</span>
          <div className="host-join-code" aria-label={`Event code ${ev.code}`}>
            {ev.code.split("").map((ch, i) => (
              <span key={`${ch}-${i}`}>{ch}</span>
            ))}
          </div>
        </div>
      </header>

      <div className="host-studio-actions">
        <article className="host-card">
          <h3>Next action</h3>
          {actions.paddle === "start" && paddleSetup ? (
            <button type="submit" form="paddle-setup" className="button host-primary" disabled={busy}>
              {primary}
            </button>
          ) : actions.paddle === "start" ? (
            <button type="button" className="button host-primary" disabled={busy} onClick={onStartPaddle}>
              {primary}
            </button>
          ) : actions.paddle === "next" ? (
            <button type="button" className="button host-primary" disabled={busy || live.paddle?.status === "paused"} onClick={onNextLevel}>
              {primary}
            </button>
          ) : (
            <p className="host-quiet">The night is closed.</p>
          )}
        </article>

        {(actions.closeLot || actions.closeAuction) && (
          <article className="host-card">
            <h3>Other controls</h3>
            <div className="host-secondary">
              {actions.closeLot && (
                <div className="host-close-lot">
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
                </div>
              )}
              {actions.closeAuction && (
                confirmClose ? (
                  <div className="host-confirm">
                    <p>Close the auction now? Bidding stops immediately.</p>
                    <button type="button" className="button danger" disabled={busy} onClick={onCloseAuction}>
                      Yes, close now
                    </button>
                    <button type="button" className="button secondary" disabled={busy} onClick={onCancelClose}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="button danger" disabled={busy} onClick={onCloseAuction}>
                    Close auction
                  </button>
                )
              )}
            </div>
          </article>
        )}
      </div>

      <aside className="host-room-preview" aria-label="Room preview">
        <div className="host-mini-band">
          <BrandMark />
          <span className="host-mini-slash" aria-hidden="true" />
          <div className="host-mini-lockup">
            <p className="host-mini-title">
              {lead ? <span>{lead}</span> : null}
              <span className="is-last">{last}</span>
            </p>
            <p className={`host-mini-status${ev.status === "open" ? " is-on" : ""}`}>{statusLabel}</p>
          </div>
        </div>
        {featured && (
          <p className="host-room-lot">
            <span>{featured.title}</span>
            <strong>{formatAmount(featured.bidCount ? featured.highBid : featured.startingBid, ccy)}</strong>
          </p>
        )}
        <Link to={`/e/${ev.code}/engager`}>Open big screen</Link>
      </aside>

      {paddleSetup && <div className="host-studio-paddle">{paddleSetup}</div>}
    </section>
  );
}
