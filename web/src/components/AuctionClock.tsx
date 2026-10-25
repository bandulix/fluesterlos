import { Line } from "./ScreenLine";
import { auctionClock, donationEndParts } from "../lib/auctionClock";
import type { EventStatus } from "../lib/bidLogic";
import { translate, type ScreenLang, type StringKey } from "../i18n";
import { DEFAULT_EVENT_TZ } from "../lib/time";

const PHASE_KEY: Record<string, StringKey> = {
  scheduled: "screen.startsIn",
  open: "screen.endsIn",
  last15: "screen.last15",
  last5: "screen.last5",
  final: "screen.final",
  closed: "screen.biddingClosed",
};

function spoken(mode: ScreenLang, key: StringKey): string {
  if (mode === "both") return `${translate("en", key)} / ${translate("th", key)}`;
  return translate(mode, key);
}

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
  /** Host setting. Defaults to English so a Thai phone does not restyle the room. */
  screenLang?: ScreenLang;
}) {
  const tz = props.timezone || DEFAULT_EVENT_TZ;
  const mode = props.screenLang ?? "en";
  const now = props.now;
  const clock = auctionClock({
    status: props.status,
    startsAt: props.startsAt,
    endsAt: props.endsAt,
    now,
    closedEarly: props.closedEarly,
  });
  const donations = donationEndParts({
    needsEndsAt: props.needsEndsAt,
    auctionEndsAt: props.endsAt,
    timezone: tz,
    now,
  });
  const closed = clock.phase === "closed";
  const headlineKey = PHASE_KEY[clock.phase] ?? "screen.endsIn";
  return (
    <div
      className={`auction-clock is-${clock.phase}${clock.pulse ? " is-pulse" : ""}${clock.bigger ? " is-bigger" : ""}${props.reduceMotion ? " is-still" : ""}`}
      role="timer"
      data-phase={clock.phase}
      aria-label={closed ? spoken(mode, "screen.biddingClosed") : `${spoken(mode, headlineKey)} ${clock.digits}`}
    >
      <p className="auction-clock-kicker">
        <Line mode={mode} k={headlineKey} />
      </p>
      {clock.closedEarly && (
        <p className="auction-clock-note">
          <Line mode={mode} k="screen.closedEarly" />
        </p>
      )}
      {!closed && <p className="auction-clock-digits">{clock.digits}</p>}
      {donations && (
        <p className="auction-clock-note">
          {donations.kind === "closed" ? (
            <Line mode={mode} k="screen.donationsClosed" />
          ) : (
            <Line mode={mode} k="screen.donationsUntil" vars={{ time: donations.time }} />
          )}
        </p>
      )}
    </div>
  );
}
