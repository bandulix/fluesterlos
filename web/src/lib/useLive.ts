import { useEffect, useRef, useState } from "react";
import { API_BASE, LivePayload } from "./api";

export function useLive(code: string | undefined) {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const prevBids = useRef<number | null>(null);

  useEffect(() => {
    if (!code) return;
    let es: EventSource | null = null;
    let cancelled = false;
    const url = `${API_BASE}/api/events/${encodeURIComponent(code)}/stream`;
    try {
      es = new EventSource(url, { withCredentials: true } as EventSourceInit);
      es.addEventListener("update", (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as LivePayload;
          setLive(payload);
          setError(null);
          const total = payload.stats.totalBids;
          if (prevBids.current !== null && total > prevBids.current) {
            setFlashKey((k) => k + 1);
          }
          prevBids.current = total;
        } catch { /* ignore */ }
      });
      es.addEventListener("bid", () => {
        setFlashKey((k) => k + 1);
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

  return { live, error, flashKey, setLive };
}
