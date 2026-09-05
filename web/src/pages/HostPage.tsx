import { FormEvent, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { api, LivePayload } from "../lib/api";
import { Countdown } from "../components/Countdown";

type DraftItem = {
  title: string;
  description: string;
  photoUrl: string;
  startingBid: string;
  minIncrement: string;
  buyNow: string;
};

const emptyItem = (): DraftItem => ({
  title: "",
  description: "",
  photoUrl: "",
  startingBid: "10",
  minIncrement: "5",
  buyNow: "",
});

export function HostPage() {
  const [token, setToken] = useState(() => localStorage.getItem("fl_host_token") || "dev-host-token-change-me");
  const [title, setTitle] = useState("Charity Silent Auction");
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const joinUrl = live?.event.joinUrl;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    localStorage.setItem("fl_host_token", token);
    try {
      const body = {
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        items: items
          .filter((it) => it.title.trim())
          .map((it) => ({
            title: it.title.trim(),
            description: it.description,
            photoUrl: it.photoUrl.trim() || null,
            startingBid: Number(it.startingBid),
            minIncrement: Number(it.minIncrement),
            buyNow: it.buyNow.trim() ? Number(it.buyNow) : null,
          })),
      };
      const res = await api<LivePayload>("/api/host/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      setLive(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <section className="stack">
      <div className="card">
        <h1>Host setup</h1>
        <p className="muted">Create an event, add items, share the QR / join link. Auction opens and closes from the schedule.</p>
        <label>Host token <input value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <form className="stack" onSubmit={onCreate}>
          <label>Event title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <div className="row">
            <label>Starts <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
            <label>Ends <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
          </div>
          <h2>Items</h2>
          {items.map((it, idx) => (
            <div className="card nested" key={idx}>
              <label>Title <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })} /></label>
              <label>Description <textarea value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} /></label>
              <label>Photo URL <input value={it.photoUrl} onChange={(e) => updateItem(idx, { photoUrl: e.target.value })} placeholder="https://…" /></label>
              <div className="row">
                <label>Starting <input type="number" step="0.01" value={it.startingBid} onChange={(e) => updateItem(idx, { startingBid: e.target.value })} /></label>
                <label>Min + <input type="number" step="0.01" value={it.minIncrement} onChange={(e) => updateItem(idx, { minIncrement: e.target.value })} /></label>
                <label>Buy now <input type="number" step="0.01" value={it.buyNow} onChange={(e) => updateItem(idx, { buyNow: e.target.value })} /></label>
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="button secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>Add item</button>
            <button className="button" disabled={busy}>{busy ? "Creating…" : "Create event"}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>

      {live && (
        <div className="card">
          <h2>{live.event.title}</h2>
          <p>Code: <code>{live.event.code}</code></p>
          <Countdown startsAt={live.event.startsAt} endsAt={live.event.endsAt} status={live.event.status} />
          {joinUrl && (
            <div className="qr-block">
              <QRCodeSVG value={joinUrl} size={180} />
              <div>
                <p><a href={joinUrl}>{joinUrl}</a></p>
                <p className="row">
                  <Link to={`/e/${live.event.code}/bid`}>Guest bid</Link>
                  <Link to={`/e/${live.event.code}/stats`}>Stats</Link>
                  <Link to={`/e/${live.event.code}/engager`}>Engager</Link>
                </p>
              </div>
            </div>
          )}
          <ul>
            {live.items.map((it) => (
              <li key={it.id}>{it.title} — high {it.highBid}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
