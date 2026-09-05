import { useEffect, useState } from "react";
import { API_BASE, LivePayload } from "./api";

export type BidFlash = {
  amount: number;
  itemId: string;
  itemTitle: string;
  guestName: string;
  createdAt: string;
};

export function useLive(code: string | undefined) {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [lastBid, setLastBid] = useState<BidFlash | null>(null);

  useEffect(() => {
    if (!code) return;
    let es: EventSource | null = null;
    let cancelled = false;
    const url = `${API_BASE}/api/events/${encodeURIComponent(code)}/stream`;
    try {
      es = new EventSource(url, { withCredentials: true } as EventSourceInit);
      es.addEventListener("update", (ev) => {
        try {
          setLive(JSON.parse((ev as MessageEvent).data));
          setError(null);
        } catch { /* ignore */ }
      });
      es.addEventListener("bid", (ev) => {
        try {
          const bid = JSON.parse((ev as MessageEvent).data) as BidFlash;
          setLastBid(bid);
          setFlashKey((k) => k + 1);
        } catch { /* ignore */ }
      });
      es.onerror = () => {
        if (!cancelled) setError("Live connection interrupted — retrying…");
      };
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [code]);

  return { live, error, flashKey, lastBid };
}
