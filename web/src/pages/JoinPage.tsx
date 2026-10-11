import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, assetUrl, getGuestToken, GuestMe, LivePayload, setGuestToken } from "../lib/api";
import { formatPhoneInput, phoneLooksComplete } from "../lib/phoneInput";
import { plural, t } from "../i18n";
import "../guest/guest.css";

type JoinResponse =
  | { guest: { token: string } }
  | { verificationRequired: true; phone: string; delivery: "email" | "desk"; maskedEmail: string | null; resendInSeconds: number };

/**
 * One screen: phone number + "Start bidding". No name, no email, no sign-up.
 * A code is asked only when this number is already bidding on another phone.
 */
export function JoinPage() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<LivePayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<{ via: "email" | "desk"; email: string | null } | null>(null);
  const verifying = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (getGuestToken(code)) {
      nav(`/e/${code}/bid`, { replace: true });
      return;
    }
    // Still signed in via cookie (e.g. storage cleared, or opened from the home screen)? Go straight in.
    api<GuestMe>(`/api/events/${code}/me`)
      .then((me) => {
        if (cancelled) return;
        if (me.guest?.token) {
          setGuestToken(code, me.guest.token);
          nav(`/e/${code}/bid`, { replace: true });
        }
      })
      .catch(() => undefined);
    api<LivePayload>(`/api/events/${code}`)
      .then((d) => !cancelled && setEvent(d))
      .catch((e) => {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [code, nav]);

  function done(token: string) {
    setGuestToken(code, token);
    nav(`/e/${code}/bid`, { replace: true });
  }

  async function requestJoin() {
    const res = await api<JoinResponse>(`/api/events/${code}/join`, { method: "POST", body: JSON.stringify({ phone }) });
    if ("guest" in res) return done(res.guest.token);
    setDelivery({ via: res.delivery, email: res.maskedEmail });
    setStep("code");
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (verifying.current) return;
    verifying.current = true;
    await run(async () => {
      const res = await api<{ guest: { token: string } }>(`/api/events/${code}/join/verify`, {
        method: "POST",
        body: JSON.stringify({ phone, code: value }),
      });
      done(res.guest.token);
    });
    verifying.current = false;
  }

  const hero = event?.items.find((it) => it.photoUrl)?.photoUrl;

  if (notFound) {
    return (
      <section className="g-page g-join">
        <p className="g-error" role="alert">{t("join.notFound")}</p>
      </section>
    );
  }

  if (step === "code") {
    return (
      <section className="g-page g-join">
        <div className="g-join-card">
          <h1 className="g-join-title">{t("code.title")}</h1>
          <p className="g-join-text">
            {delivery?.via === "email" && delivery.email ? t("code.introEmail", { email: delivery.email }) : t("code.introDesk")}
          </p>
          {delivery?.via === "email" && <p className="g-muted">{t("code.deskAlso")}</p>}
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (otp.length === 6) verify(otp);
            }}
          >
            <label className="g-field-label" htmlFor="g-otp">{t("code.label")}</label>
            <input
              id="g-otp"
              className="g-big-input g-otp"
              value={otp}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtp(v);
                if (v.length === 6) verify(v); // no extra tap needed
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              placeholder="••••••"
              autoFocus
            />
            <button className="g-primary" disabled={busy || otp.length !== 6}>
              {busy ? t("join.starting") : t("code.continue")}
            </button>
          </form>
          {error && <p className="g-error" role="alert">{error}</p>}
          <div className="g-join-links">
            <button type="button" className="g-link" disabled={busy} onClick={() => run(requestJoin)}>
              {t("code.resend")}
            </button>
            <button
              type="button"
              className="g-link"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setOtp("");
                setError(null);
              }}
            >
              {t("code.otherNumber")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const ready = phoneLooksComplete(phone);
  return (
    <section className="g-page g-join">
      <div className="g-join-hero" aria-hidden="true">
        {hero ? <img src={assetUrl(hero)} alt="" /> : null}
      </div>
      <div className="g-join-card">
        <p className="g-kicker">{t("join.kicker")}</p>
        <h1 className="g-join-title">{event?.event.title ?? "\u00a0"}</h1>
        {event && <p className="g-muted">{plural("join.oneItem", "join.items", event.items.length)}</p>}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (ready && !busy) run(requestJoin);
          }}
        >
          <label className="g-field-label" htmlFor="g-phone">{t("join.phoneLabel")}</label>
          <input
            id="g-phone"
            className="g-big-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="go"
            value={phone}
            placeholder={t("join.phonePlaceholder")}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            aria-describedby="g-phone-hint"
          />
          <p id="g-phone-hint" className="g-muted g-small">{t("join.phoneHint")}</p>
          <button className="g-primary" disabled={busy || !ready}>
            {busy ? t("join.starting") : t("join.start")}
          </button>
        </form>
        {error && <p className="g-error" role="alert">{error}</p>}
        <p className="g-muted g-small g-center">🔒 {t("join.privacy")}</p>
      </div>
    </section>
  );
}
