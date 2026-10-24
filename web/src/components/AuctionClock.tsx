import { auctionClock, donationEndLine } from "../lib/auctionClock";
import type { EventStatus } from "../lib/bidLogic";
import { DEFAULT_EVENT_TZ } from "../lib/time";

/** Pinned auction countdown. The same size on every big-screen frame. */
export function AuctionClock(props: {
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  closedEarly?: boolean;
  needsEndsAt?: string | null;
  timezone?: string;
  now: number;
  reduceMotion: boolean;
}) {
  const tz = props.timezone || DEFAULT_EVENT_TZ;
  const now = props.now;
  const clock = auctionClock({
    status: props.status,
    startsAt: props.startsAt,
    endsAt: props.endsAt,
    now,
    closedEarly: props.closedEarly,
  });
  const donations = donationEndLine({
    needsEndsAt: props.needsEndsAt,
    auctionEndsAt: props.endsAt,
    timezone: tz,
    now,
  });
  const closed = clock.phase === "closed";
  return (
    <div
      className={`auction-clock is-${clock.phase}${clock.pulse ? " is-pulse" : ""}${clock.bigger ? " is-bigger" : ""}${props.reduceMotion ? " is-still" : ""}`}
      role="timer"
      data-phase={clock.phase}
      aria-label={closed ? clock.headline : `${clock.headline} ${clock.digits}`}
    >
      <p className="auction-clock-kicker">{clock.headline}{clock.closedEarly ? " · Closed early" : ""}</p>
      <p className="auction-clock-digits">{closed ? "Bidding closed" : clock.digits}</p>
      {donations && <p className="auction-clock-note">{donations}</p>}
    </div>
  );
}
