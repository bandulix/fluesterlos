import { useEffect, useRef, useState } from "react";
import type { PaddleRaise } from "../lib/api";
import { paddleHit, paddleProgress } from "../lib/paddleLogic";
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
}) {
  const { paddle, ccy, reduceMotion } = props;
  const money = (n: number) => formatAmount(n, ccy);
  const shown = useCountUp(paddle.raised, reduceMotion);
  const hit = paddleHit(paddle.raised, paddle.goal);
  const width = paddleProgress(shown, paddle.goal);
  const paused = paddle.status === "paused";
  return (
    <section className={`paddle-stage${hit ? " is-hit" : ""}${paused ? " is-paused" : ""}${reduceMotion ? " is-still" : ""}`} aria-live="polite">
      {hit && !reduceMotion && (
        <div className="paddle-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => <i key={i} />)}
        </div>
      )}
      <p className="paddle-kicker">{paddle.title}</p>
      {paddle.level != null && <h2 className="paddle-ask">Who raises at {money(paddle.level)}?</h2>}
      {paused && <p className="paddle-paused">Paused</p>}
      <p className="paddle-total">{money(Math.round(shown))}</p>
      <div className="paddle-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(paddleProgress(paddle.raised, paddle.goal))} aria-label={`${money(paddle.raised)} of ${money(paddle.goal)}`}>
        <span style={{ width: `${width}%` }} />
      </div>
      <p className="paddle-goal">
        {money(paddle.raised)} of {money(paddle.goal)}
        {hit && <strong> · Goal reached</strong>}
      </p>
      <ul className="paddle-pops">
        {paddle.pops.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
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
    if (still) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = from.current;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) {
      from.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 700);
      const eased = 1 - (1 - p) ** 3;
      const next = start + delta * eased;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, still]);
  return value;
}
