import { useEffect, useState } from "react";

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function Countdown({ startsAt, endsAt, status }: { startsAt: string; endsAt: string; status: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const target = status === "scheduled" ? new Date(startsAt).getTime() : new Date(endsAt).getTime();
  const label = status === "scheduled" ? "Starts in" : status === "open" ? "Ends in" : "Closed";
  const ms = Math.max(0, target - now);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (
    <div className="countdown">
      <span className="muted">{label}</span>
      <strong>{status === "closed" ? "—" : `${pad(h)}:${pad(m)}:${pad(s)}`}</strong>
      <span className={`pill status-${status}`}>{status}</span>
    </div>
  );
}
