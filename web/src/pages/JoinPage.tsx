import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, getGuestToken, setGuestToken } from "../lib/api";

export function JoinPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    const existing = getGuestToken(code);
    if (existing) nav(`/e/${code}/bid`, { replace: true });
    api<{ event: { title: string } }>(`/api/events/${code}`)
      .then((d) => setTitle(d.event.title))
      .catch((e) => setError(e.message));
  }, [code, nav]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ guest: { token: string } }>(`/api/events/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ name, email }),
      });
      setGuestToken(code, res.guest.token);
      nav(`/e/${code}/bid`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card narrow">
      <h1>{title || "Join"}</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Name (on the board) <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Optional" /></label>
        <button className="button">Bid</button>
        {error && <p className="error">{String(error)}</p>}
      </form>
    </section>
  );
}
