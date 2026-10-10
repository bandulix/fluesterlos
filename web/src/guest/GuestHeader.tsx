import type { ReactNode } from "react";
import { formatRemaining, EventStatus } from "../lib/bidLogic";
import { formatTimeInZone } from "../lib/time";
import { t } from "../i18n";

/** Sticky top: event title + server-time countdown. */
export function GuestHeader(props: {
  title: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  now: number;
  timezone?: string;
  closedEarly?: boolean;
  right?: ReactNode;
}) {
  const { title, status, startsAt, endsAt, now, timezone, closedEarly, right } = props;
  const target = status === "scheduled" ? Date.parse(startsAt) : Date.parse(endsAt);
  const remaining = target - now;
  const urgent = status === "open" && remaining <= 60_000;
  const tz = timezone || "Asia/Bangkok";
  return (
    <header className="g-header">
      <div className="g-header-main">
        <h1 className="g-title">{title}</h1>
        {right}
      </div>
      <div className={`g-timer g-timer-${status}${urgent ? " is-urgent" : ""}`} aria-live="off">
        {status === "closed" ? (
          <span>{closedEarly ? t("bid.closedEarly") : t("bid.ended")}</span>
        ) : (
          <>
            <span className="g-timer-label">{status === "scheduled" ? t("bid.startsIn") : t("bid.endsIn")}</span>
            <strong className="g-timer-digits">{formatRemaining(remaining)}</strong>
            <span className="g-timer-at">· {formatTimeInZone(status === "scheduled" ? startsAt : endsAt, tz)}</span>
          </>
        )}
      </div>
    </header>
  );
}
