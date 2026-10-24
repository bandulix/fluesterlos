import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, assetUrl, getGuestToken, GuestMe, LivePayload, setGuestToken } from "../lib/api";
import { formatPhoneInput, phoneLooksComplete } from "../lib/phoneInput";
import { clearPendingJoin, loadPendingJoin, savePendingJoin } from "../lib/pendingJoin";
import { BrandMark } from "../components/BrandMark";
import { formatInZone } from "../lib/time";
import { plural, t } from "../i18n";
import { LangSwitch } from "../guest/LangSwitch";
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
  // Coming back from the mail app / the desk restores the code step instead of an empty form.
  const [pending] = useState(() => loadPendingJoin(code));
  const [phone, setPhone] = useState(pending?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [event, setEvent] = useState<LivePayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<"phone" | "code">(pending ? "code" : "phone");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<{ via: "email" | "desk"; email: string | null } | null>(
    pending ? { via: pending.via, email: pending.email } : null,
  );
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
    clearPendingJoin(code);
    setGuestToken(code, token);
    nav(`/e/${code}/bid`, { replace: true });
  }

  async function requestJoin(): Promise<"joined" | { resendInSeconds: number }> {
    const res = await api<JoinResponse>(`/api/events/${code}/join`, { method: "POST", body: JSON.stringify({ phone }) });
    if ("guest" in res) {
      done(res.guest.token);
      return "joined";
    }
    setDelivery({ via: res.delivery, email: res.maskedEmail });
    savePendingJoin(code, { phone, via: res.delivery, email: res.maskedEmail });
    setStep("code");
    return { resendInSeconds: res.resendInSeconds };
  }

  async function resend() {
    const via = delivery?.via;
    const r = await requestJoin();
    if (r === "joined") return;
    // The server hands out a fresh code at most once a minute; within that minute the last one is still valid.
    const fresh = r.resendInSeconds >= 60;
    if (via === "email") setInfo(fresh ? t("code.resentEmail") : t("code.recentEmail", { n: r.resendInSeconds }));
    else setInfo(fresh ? t("code.resentDesk") : t("code.recentDesk"));
  }

  function otherNumber() {
    clearPendingJoin(code);
    setStep("phone");
    setOtp("");
    setError(null);
    setInfo(null);
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setInfo(null);
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
        <LangSwitch />
        <p className="g-error" role="alert">{t("join.notFound")}</p>
      </section>
    );
  }

  if (step === "code") {
    return (
      <section className="g-page g-join">
        <div className="g-join-card">
          <LangSwitch />
          <BrandMark kind="lockup" />
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
          {info && <p className="g-ok" role="status">{info}</p>}
          <div className="g-join-links">
            <button type="button" className="g-link" disabled={busy} onClick={() => run(resend)}>
              {delivery?.via === "email" ? t("code.resendEmail") : t("code.resendDesk")}
            </button>
            <button type="button" className="g-link" disabled={busy} onClick={otherNumber}>
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
        <LangSwitch />
        <BrandMark kind="lockup" />
        <p className="g-kicker">{t("join.kicker")}</p>
        <h1 className="g-join-title">{event?.event.title ?? "\u00a0"}</h1>
        {event && (
          <div className="g-meta">
            <span>{plural("join.oneItem", "join.items", event.items.length)}</span>
            <span>{formatInZone(event.event.startsAt, event.event.timezone || "Asia/Bangkok")}</span>
          </div>
        )}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (busy) return;
            if (!ready) {
              // The button always looks tappable; an incomplete number gets a gentle inline hint instead.
              setHint(true);
              document.getElementById("g-phone")?.focus();
              return;
            }
            run(requestJoin);
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
            onChange={(e) => {
              setPhone(formatPhoneInput(e.target.value));
              setHint(false);
            }}
            aria-describedby="g-phone-hint"
            aria-invalid={hint || undefined}
          />
          <p id="g-phone-hint" className={hint ? "g-hint-warn g-small" : "g-muted g-small"} role={hint ? "alert" : undefined}>
            {hint ? t("join.needFullNumber") : t("join.phoneHint")}
          </p>
          <button className="g-primary" disabled={busy}>
            {busy ? t("join.starting") : t("join.start")}
          </button>
        </form>
        {error && <p className="g-error" role="alert">{error}</p>}
        <p className="g-muted g-small g-center">🔒 {t("join.privacy")}</p>
      </div>
    </section>
  );
}
