import { PaddleRaise } from "../lib/api";
import { formatAmount, type Currency } from "../lib/money";
import { t } from "../i18n";
import { paddleTiles } from "../lib/p2";

function appealTitle(title: string): string {
  return title === "Paddle raise" ? t("paddle.hostTitle") : title;
}

/** One tap at the level the room is being asked for. */
export function PaddleCard(props: {
  paddle: PaddleRaise;
  ccy: Currency;
  busy: boolean;
  onRaise: (amount: number) => void;
}) {
  const { paddle, ccy, busy, onRaise } = props;
  if (paddle.status === "ended" || paddle.level == null) return null;
  const amount = formatAmount(paddle.level, ccy);
  const paused = paddle.status === "paused";
  const tiles = paddleTiles(paddle.levels, paddle.levelIndex);
  return (
    <section className="g-paddle" aria-live="polite">
      <p className="g-kicker">{appealTitle(paddle.title)}</p>
      {paddle.hitGoal ? (
        <>
          <h2>{t("paddle.thanks")}</h2>
          <p className="g-paddle-still">{t("paddle.still", { amount })}</p>
        </>
      ) : (
        <h2>{t("paddle.ask", { amount })}</h2>
      )}
      <p className="g-muted">{t("paddle.goal", { raised: formatAmount(paddle.raised, ccy), goal: formatAmount(paddle.goal, ccy) })}</p>
      {paused ? (
        <p className="g-info">{t("paddle.paused")}</p>
      ) : (
        <div className="g-paddle-tiles">
          <button type="button" className="g-bid g-paddle-now" disabled={busy} onClick={() => onRaise(paddle.level!)}>
            {busy ? t("bid.sending") : t("paddle.raiseNow", { amount })}
          </button>
          {tiles.some((level) => level !== paddle.level) && (
            <div className="g-paddle-neighbours">
              {tiles.filter((level) => level !== paddle.level).map((level) => (
                <button key={level} type="button" className="g-tile" disabled={busy} onClick={() => onRaise(level)}>
                  {formatAmount(level, ccy)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
