import { useEffect, useState } from "react";
import { api, LoginRequest } from "../lib/api";
import { DEFAULT_EVENT_TZ, formatTimeInZone, offsetLabel } from "../lib/time";

/**
 * Help desk: guests whose phone is already in use on another device need a 6-digit code.
 * If they have no email (or SMTP is off) the code is only shown here. Check who they are
 * (e.g. ask for their name / look at their phone) before reading the code out.
 */
export function HelpDeskCard({ code, timezone }: { code: string; timezone?: string }) {
  const tz = timezone || DEFAULT_EVENT_TZ;
  const [requests, setRequests] = useState<LoginRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await api<{ requests: LoginRequest[] }>(`/api/host/events/${code}/login-requests`);
        if (!stop) {
          setRequests(res.requests);
          setError(null);
        }
      } catch (err) {
        if (!stop) setError((err as Error).message);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [code]);

  return (
    <div className="card">
      <h2>Help desk — login codes</h2>
      <p className="muted">
        Guests switching to a new phone or browser need a code. Check it is really them, then read the code out.
        Codes expire after 10 minutes and disappear here once used.
      </p>
      {error && <p className="error">{error}</p>}
      {requests.length === 0 ? (
        <p className="muted">No pending requests.</p>
      ) : (
        <ul className="auction-list">
          {requests.map((r) => (
            <li key={r.id} className="auction-row">
              <span className="auction-meta">
                <strong>{r.guestName}</strong>
                <span className="muted">
                  {r.phone ?? r.email} · {r.delivery === "email" ? "also emailed" : "desk only"} · requested{" "}
                  {formatTimeInZone(r.requestedAt, tz)} ({offsetLabel(tz)}) · expires {formatTimeInZone(r.expiresAt, tz)}
                  {r.attempts ? ` · ${r.attempts} wrong tries` : ""}
                </span>
              </span>
              {reveal[r.id] ? (
                <span className="desk-code">{r.code}</span>
              ) : (
                <button type="button" className="button secondary" onClick={() => setReveal((p) => ({ ...p, [r.id]: true }))}>
                  Show code
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
