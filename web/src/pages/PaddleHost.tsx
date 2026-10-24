import { FormEvent, useEffect, useState } from "react";
import { api, LivePayload, PaddleRaise } from "../lib/api";
import { formatAmount, type Currency } from "../lib/money";
import type { RunAction } from "./HostEventCard";

type NeedOpt = { id: string; title: string; targetAmount: number };

const DEFAULT_LEVELS = "50000, 20000, 10000, 5000, 2000";

/** Host controls for the live paddle raise: start, next level, pause, end, and a paddle seen in the room. */
export function PaddleHost(props: { code: string; ccy: Currency; run: RunAction }) {
  const { code, ccy, run } = props;
  const [needs, setNeeds] = useState<NeedOpt[]>([]);
  const [needId, setNeedId] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("100000");
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [who, setWho] = useState("");
  const [paddle, setPaddle] = useState<PaddleRaise | null>(null);

  useEffect(() => {
    api<{ needs?: NeedOpt[]; paddle?: PaddleRaise | null }>(`/api/events/${code}`)
      .then((live) => {
        setNeeds(live.needs ?? []);
        setPaddle(live.paddle ?? null);
      })
      .catch(() => undefined);
  }, [code]);

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
      "Paddle raise is live.",
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
    }, `Paddle added for ${name}.`);
    if (ok) setWho("");
  }

  const live = paddle && (paddle.status === "live" || paddle.status === "paused");
  return (
    <section className="stack paddle-host">
      <h3>Paddle raise</h3>
      {paddle && (
        <p className="muted">
          {paddle.status === "live" && paddle.level != null && <>Calling {formatAmount(paddle.level, ccy)} · </>}
          {paddle.status === "paused" && <>Paused · </>}
          {paddle.status === "ended" && <>Ended · </>}
          {formatAmount(paddle.raised, ccy)} of {formatAmount(paddle.goal, ccy)}
          {paddle.hitGoal ? " · Goal reached" : ""}
        </p>
      )}
      {!live && (
        <form className="stack" onSubmit={onStart}>
          <label>
            Need
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
              <option value="">General appeal</option>
              {needs.map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </label>
          <label>
            Appeal name
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The school fund" maxLength={200} />
          </label>
          <label>
            Goal (THB)
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label>
            Levels, highest first
            <input value={levels} onChange={(e) => setLevels(e.target.value)} />
          </label>
          <button className="button" type="submit">Start paddle raise</button>
        </form>
      )}
      {live && paddle && (
        <div className="row">
          <button type="button" className="button" onClick={() => send({ action: "next" }, "Next level.")}>Next level</button>
          {paddle.status === "live" ? (
            <button type="button" className="button secondary" onClick={() => send({ action: "pause" }, "Paddle raise paused.")}>Pause</button>
          ) : (
            <button type="button" className="button secondary" onClick={() => send({ action: "resume" }, "Paddle raise resumed.")}>Resume</button>
          )}
          <button type="button" className="button secondary" onClick={() => send({ action: "end" }, "Paddle raise ended.")}>End</button>
        </div>
      )}
      {paddle?.status === "live" && (
        <form className="row" onSubmit={onManual}>
          <input
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="Name or guest number"
            aria-label="Name or guest number"
            maxLength={80}
          />
          <button className="button secondary" type="submit">Add paddle</button>
        </form>
      )}
    </section>
  );
}
