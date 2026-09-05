import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
      <h1>Join {title || "event"}</h1>
      <p className="muted">Name + email only. No OTP. Your session sticks on this device.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button className="button">Continue to bidding</button>
        {error && <p className="error">{String(error)}</p>}
      </form>
      <p className="row muted">
        <Link to={`/e/${code}/stats`}>Public stats</Link>
        <Link to={`/e/${code}/engager`}>Engager</Link>
      </p>
    </section>
  );
}
