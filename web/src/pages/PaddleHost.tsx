import { FormEvent, useEffect, useState } from "react";
import { api, LivePayload, PaddleRaise } from "../lib/api";
import { t } from "../i18n";
import { formatAmount, type Currency } from "../lib/money";
import { paddleProgress } from "../lib/paddleLogic";
import type { RunAction } from "./HostEventCard";

type NeedOpt = { id: string; title: string; targetAmount: number };

const DEFAULT_LEVELS = "50000, 20000, 10000, 5000, 2000";

/** Host controls for the live paddle raise: start, next level, pause, end, and a paddle seen in the room. */
export function PaddleHost(props: {
  code: string;
  ccy: Currency;
  run: RunAction;
  /** From the host page's live payload, so this panel does not open its own connection. */
  paddle?: PaddleRaise | null;
  needs?: NeedOpt[];
}) {
  const { code, ccy, run } = props;
  const [needs, setNeeds] = useState<NeedOpt[]>(props.needs ?? []);
  const [needId, setNeedId] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("100000");
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [who, setWho] = useState("");
  const [paddle, setPaddle] = useState<PaddleRaise | null>(props.paddle ?? null);

  useEffect(() => {
    if (props.paddle !== undefined) setPaddle(props.paddle);
  }, [props.paddle]);

  useEffect(() => {
    if (props.needs) setNeeds(props.needs);
  }, [props.needs]);

  useEffect(() => {
    if (props.paddle !== undefined) return;
    api<{ needs?: NeedOpt[]; paddle?: PaddleRaise | null }>(`/api/events/${code}`)
      .then((live) => {
        setNeeds(live.needs ?? []);
        setPaddle(live.paddle ?? null);
      })
      .catch(() => undefined);
  }, [code, props.paddle]);

  function parsedLevels(): number[] {
    return levels
      .split(/[^0-9.]+/)
      .map((s) => Number(s))
      .filter((n) => n > 0);
  }

  async function send(body: unknown, note: string) {
    const ok = await run(async () => {
      const res = await api<{ live: LivePayload }>(`/api/host/events/${code}/paddle`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setPaddle(res.live.paddle ?? null);
      return res.live;
    }, note);
    return ok;
  }

  async function onStart(e: FormEvent) {
    e.preventDefault();
    const nums = parsedLevels();
    await send(
      {
        action: "start",
        needId: needId || null,
        title: title.trim() || undefined,
        levels: nums,
        goal: Number(goal),
      },
      t("paddle.liveNote"),
    );
  }

  async function onManual(e: FormEvent) {
    e.preventDefault();
    const name = who.trim();
    if (!name) return;
    const ok = await run(async () => {
      const res = await api<{ live: LivePayload }>(`/api/host/events/${code}/paddle/pledge`, {
        method: "POST",
        body: JSON.stringify({ who: name }),
      });
      setPaddle(res.live.paddle ?? null);
      return res.live;
    }, t("paddle.added", { name }));
    if (ok) setWho("");
  }

  const live = paddle && (paddle.status === "live" || paddle.status === "paused");
  return (
    <section className="stack paddle-host">
      <h3>{t("paddle.hostTitle")}</h3>
      {paddle && !live && (
        <p className="muted">
          {paddle.status === "ended" && <>{t("paddle.statusEnded")} · </>}
          {t("paddle.goal", { raised: formatAmount(paddle.raised, ccy), goal: formatAmount(paddle.goal, ccy) })}
          {paddle.hitGoal ? ` · ${t("paddle.hit")}` : ""}
        </p>
      )}
      {!live && (
        <form className="stack" onSubmit={onStart}>
          <label>
            {t("paddle.need")}
            <select
              value={needId}
              onChange={(e) => {
                const id = e.target.value;
                setNeedId(id);
                const need = needs.find((n) => n.id === id);
                if (need) {
                  setTitle(need.title);
                  setGoal(String(need.targetAmount));
                }
              }}
            >
              <option value="">{t("paddle.general")}</option>
              {needs.map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </label>
          <label>
            {t("paddle.appeal")}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("paddle.appealPh")} maxLength={200} />
          </label>
          <label>
            {t("paddle.goalLabel", { currency: ccy })}
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label>
            {t("paddle.levels")}
            <input value={levels} onChange={(e) => setLevels(e.target.value)} />
          </label>
          <button className="button" type="submit">{t("paddle.start")}</button>
        </form>
      )}
      {live && paddle && (
        <div className="paddle-hero">
          <p className="paddle-hero-kicker">
            {paddle.status === "paused" ? t("paddle.pausedShort") : t("paddle.calling", { amount: formatAmount(paddle.level ?? paddle.raised, ccy) })}
          </p>
          <p className="paddle-hero-level">{formatAmount(paddle.level ?? paddle.raised, ccy)}</p>
          <div
            className="need-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(paddleProgress(paddle.raised, paddle.goal))}
            aria-label={t("paddle.goal", { raised: formatAmount(paddle.raised, ccy), goal: formatAmount(paddle.goal, ccy) })}
          >
            <span style={{ width: `${paddleProgress(paddle.raised, paddle.goal)}%` }} />
          </div>
          <p className="paddle-hero-meta">
            {paddle.hitGoal
              ? t("paddle.hit")
              : t("paddle.toGo", { amount: formatAmount(Math.max(0, paddle.goal - paddle.raised), ccy) })}
            {" · "}
            {t(paddle.pledgeCount === 1 ? "paddle.pledge" : "paddle.pledges", { count: paddle.pledgeCount })}
          </p>
          <div className="row">
            <button type="button" className="button" onClick={() => send({ action: "next" }, t("paddle.nextNote"))}>{t("paddle.next")}</button>
            {paddle.status === "live" ? (
              <button type="button" className="button secondary" onClick={() => send({ action: "pause" }, t("paddle.pauseNote"))}>{t("paddle.pause")}</button>
            ) : (
              <button type="button" className="button secondary" onClick={() => send({ action: "resume" }, t("paddle.resumeNote"))}>{t("paddle.resume")}</button>
            )}
            <button type="button" className="button secondary" onClick={() => send({ action: "end" }, t("paddle.endNote"))}>{t("paddle.end")}</button>
          </div>
        </div>
      )}
      {paddle?.status === "live" && (
        <form className="row" onSubmit={onManual}>
          <input
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder={t("paddle.who")}
            aria-label={t("paddle.who")}
            maxLength={80}
          />
          <button className="button secondary" type="submit">{t("paddle.add")}</button>
        </form>
      )}
    </section>
  );
}
