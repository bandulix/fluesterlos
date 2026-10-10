import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, getGuestToken, setGuestToken } from "../lib/api";

type JoinResponse =
  | { guest: { token: string } }
  | {
      verificationRequired: true;
      phone: string;
      delivery: "email" | "desk";
      maskedEmail: string | null;
      resendInSeconds: number;
    };

export function JoinPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const existing = getGuestToken(code);
    if (existing) nav(`/e/${code}/bid`, { replace: true });
    api<{ event: { title: string } }>(`/api/events/${code}`)
      .then((d) => setTitle(d.event.title))
      .catch((e) => setError(e.message));
  }, [code, nav]);

  function done(token: string) {
    setGuestToken(code, token);
    nav(`/e/${code}/bid`);
  }

  async function requestJoin() {
    const res = await api<JoinResponse>(`/api/events/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ name, phone, email }),
    });
    if ("guest" in res) {
      done(res.guest.token);
      return;
    }
    setStep("code");
    setNotice(
      res.delivery === "email" && res.maskedEmail
        ? `This number is already bidding on another device. We emailed a 6-digit code to ${res.maskedEmail}. ` +
            "No email? The help desk can give you the code."
        : "This number is already bidding on another device. Please go to the help desk — " +
            "a host will check who you are and give you a 6-digit code.",
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestJoin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ guest: { token: string } }>(`/api/events/${code}/join/verify`, {
        method: "POST",
        body: JSON.stringify({ phone, code: otp, name }),
      });
      done(res.guest.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    setBusy(true);
    try {
      await requestJoin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <section className="card narrow">
        <h1>{title || "Join"}</h1>
        <form className="stack" onSubmit={onVerify}>
          {notice && <p className="muted" role="status">{notice}</p>}
          <label>
            Code
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              placeholder="123456"
              required
              autoFocus
            />
          </label>
          <button className="button" disabled={busy || otp.length !== 6}>Continue</button>
          <div className="row">
            <button type="button" className="button secondary" disabled={busy} onClick={onResend}>Send a new code</button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => { setStep("email"); setOtp(""); setNotice(null); setError(null); }}
            >
              Use another number
            </button>
          </div>
          {error && <p className="error" role="alert">{String(error)}</p>}
        </form>
      </section>
    );
  }

  return (
    <section className="card narrow">
      <h1>{title || "Join"}</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          Mobile number
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoComplete="tel"
            placeholder="081 234 5678"
          />
        </label>
        <label>Name (on the board) <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Optional" /></label>
        <label>
          Email <span className="muted">(optional — only to receive voucher PDFs if you win)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <button className="button" disabled={busy}>Bid</button>
        {error && <p className="error" role="alert">{String(error)}</p>}
      </form>
    </section>
  );
}
