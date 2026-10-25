import { useLayoutEffect, useRef, type ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { formatRemaining, EventStatus } from "../lib/bidLogic";
import { formatTimeInZone } from "../lib/time";
import { t } from "../i18n";
import { LangSwitch } from "./LangSwitch";

/** Last word in red, the rest in ink. CSS uppercases the stored title. */
function HeaderTitle({ title }: { title: string }) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  const lead = words.slice(0, -1).join(" ");
  return (
    <h1 className="g-title" title={title}>
      {lead ? <span className="g-title-lead">{lead}</span> : null}
      <span className="g-title-last">{last}</span>
    </h1>
  );
}

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
  /** Trailing slot after the countdown (the "⋯" menu). */
  menu?: ReactNode;
}) {
  const { title, status, startsAt, endsAt, now, timezone, closedEarly, right, menu } = props;
  const target = status === "scheduled" ? Date.parse(startsAt) : Date.parse(endsAt);
  const remaining = target - now;
  const urgent = status === "open" && remaining > 0 && remaining <= 60_000;
  const finalFive = status === "open" && remaining > 0 && remaining <= 5 * 60_000;
  const tz = timezone || "Asia/Bangkok";
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => el.parentElement?.style.setProperty("--g-header-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="g-header" ref={headerRef}>
      <div className="g-header-main">
        <BrandMark />
        <HeaderTitle title={title} />
        {right}
      </div>
      <div className={`g-timer g-timer-${status}${finalFive ? " is-final" : ""}${urgent ? " is-urgent" : ""}`} aria-live="off">
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
      {menu}
      <LangSwitch />
    </header>
  );
}
