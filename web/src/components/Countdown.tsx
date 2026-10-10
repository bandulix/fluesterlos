import { useEffect, useState } from "react";
import { DEFAULT_EVENT_TZ, formatInZone, formatTimeInZone, offsetLabel } from "../lib/time";

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function Countdown({
  startsAt,
  endsAt,
  status,
  timezone,
  closedEarly,
}: {
  startsAt: string;
  endsAt: string;
  status: string;
  timezone?: string;
  closedEarly?: boolean;
}) {
  const tz = timezone || DEFAULT_EVENT_TZ;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const target = status === "scheduled" ? new Date(startsAt).getTime() : new Date(endsAt).getTime();
  const ms = Math.max(0, target - now);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const urgent = status === "open" && ms > 0 && ms <= 60_000;
  const zone = `${tz.split("/").pop()?.replace(/_/g, " ")} time, ${offsetLabel(tz, target)}`;
  return (
    <div className={`countdown${urgent ? " is-urgent" : ""}`}>
      {status === "closed" ? (
        <>
          <span className="muted">{closedEarly ? "Closed early" : "Ended"}</span>
          <strong className="countdown-digits countdown-when" title={zone}>
            {formatInZone(endsAt, tz)}
          </strong>
        </>
      ) : (
        <>
          <span className="muted" title={zone}>
            {status === "scheduled" ? `Starts ${formatTimeInZone(startsAt, tz)} · in` : `Ends ${formatTimeInZone(endsAt, tz)} · in`}
          </span>
          <strong className="countdown-digits">{`${pad(h)}:${pad(m)}:${pad(s)}`}</strong>
        </>
      )}
      <span className={`pill status-${status}`}>{status}</span>
    </div>
  );
}
