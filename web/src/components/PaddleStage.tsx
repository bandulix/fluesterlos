import { useEffect, useRef, useState } from "react";
import type { PaddleRaise } from "../lib/api";
import { SERVER_GENEROUS, SERVER_GUEST, translate, type ScreenLang } from "../i18n";
import { Line } from "./ScreenLine";
import { countUpAt, COUNT_UP_MS, paddleHit, paddleProgress } from "../lib/paddleLogic";
import { formatAmount, type Currency } from "../lib/money";

/**
 * Room display for a live paddle raise. The layout follows a charity goal counter:
 * the ask, a large running total, a bar to the goal, and gifts appearing as they land.
 * GoFundMe's campaign page is the reference for the total-and-bar pairing.
 */
export function PaddleStage(props: {
  paddle: PaddleRaise;
  ccy: Currency;
  reduceMotion: boolean;
  /** Room language from the host. This display does not follow the phone. */
  screenLang: ScreenLang;
}) {
  const { paddle, ccy, reduceMotion, screenLang } = props;
  const money = (n: number) => formatAmount(n, ccy);
  const shown = useCountUp(paddle.raised, reduceMotion);
  const hit = paddleHit(paddle.raised, paddle.goal);
  const settled = shown === paddle.raised;
  const width = paddleProgress(settled ? paddle.raised : shown, paddle.goal);
  const paused = paddle.status === "paused";
  const level = paddle.level != null ? money(paddle.level) : "";
  const spoken = screenLang === "th" || screenLang === "de" ? screenLang : "en";
  const goalLine = translate(spoken, "paddle.goal", { raised: money(paddle.raised), goal: money(paddle.goal) });
  return (
    <section className={`paddle-stage${hit ? " is-hit" : ""}${paused ? " is-paused" : ""}${reduceMotion ? " is-still" : ""}`} aria-live="polite">
      {hit && !reduceMotion && (
        <div className="paddle-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => <i key={i} />)}
        </div>
      )}
      <p className="paddle-kicker">{paddle.title === "Paddle raise" ? <Line mode={screenLang} k="paddle.hostTitle" /> : paddle.title}</p>
      {hit ? (
        <h2 className="paddle-ask"><Line mode={screenLang} k="paddle.thanks" /></h2>
      ) : (
        paddle.level != null && <h2 className="paddle-ask"><Line mode={screenLang} k="paddle.ask" vars={{ amount: level }} /></h2>
      )}
      {hit && paddle.level != null && <p className="paddle-still"><Line mode={screenLang} k="paddle.still" vars={{ amount: level }} /></p>}
      {paused && <p className="paddle-paused"><Line mode={screenLang} k="paddle.pausedShort" /></p>}
      <p className="paddle-total">{settled ? money(paddle.raised) : money(Math.round(shown))}</p>
      <div className="paddle-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(paddleProgress(paddle.raised, paddle.goal))} aria-label={goalLine}>
        <span style={{ width: `${width}%` }} />
      </div>
      <p className="paddle-goal"><Line mode={screenLang} k="paddle.goal" vars={{ raised: money(paddle.raised), goal: money(paddle.goal) }} /></p>
      <p className="paddle-count">
        <Line mode={screenLang} k={paddle.pledgeCount === 1 ? "paddle.pledge" : "paddle.pledges"} vars={{ count: paddle.pledgeCount }} />
        {paddle.level != null && (
          <>
            <span aria-hidden="true"> · </span>
            <Line mode={screenLang} k={paddle.atLevel === 1 ? "paddle.atLevelOne" : "paddle.atLevel"} vars={{ count: paddle.atLevel, amount: level }} />
          </>
        )}
      </p>
      <ul className="paddle-pops">
        {paddle.pops.map((p, i) => (
          <li key={p.id} className={i === 0 ? "is-new" : undefined}>
            <span>
              {p.name === SERVER_GENEROUS ? <Line mode={screenLang} k="paddle.generous" /> : p.name === SERVER_GUEST ? <Line mode={screenLang} k="screen.guest" /> : p.name}
            </span>
            <strong>{money(p.amount)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useCountUp(target: number, still: boolean): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (still || from.current === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const next = countUpAt(start, target, now - t0, COUNT_UP_MS);
      if (next === target) {
        from.current = target;
        setValue(target);
        return;
      }
      setValue(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, still]);
  return value;
}
