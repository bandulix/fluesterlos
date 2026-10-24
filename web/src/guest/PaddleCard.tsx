import { PaddleRaise } from "../lib/api";
import { formatAmount, type Currency } from "../lib/money";
import { t } from "../i18n";

/** One tap at the level the room is being asked for. */
export function PaddleCard(props: {
  paddle: PaddleRaise;
  ccy: Currency;
  busy: boolean;
  onRaise: () => void;
}) {
  const { paddle, ccy, busy, onRaise } = props;
  if (paddle.status === "ended" || paddle.level == null) return null;
  const amount = formatAmount(paddle.level, ccy);
  const paused = paddle.status === "paused";
  return (
    <section className="g-paddle" aria-live="polite">
      <p className="g-kicker">{paddle.title}</p>
      <h2>{t("paddle.ask", { amount })}</h2>
      <p className="g-muted">{t("paddle.goal", { raised: formatAmount(paddle.raised, ccy), goal: formatAmount(paddle.goal, ccy) })}</p>
      {paused ? (
        <p className="g-info">{t("paddle.paused")}</p>
      ) : (
        <button type="button" className="g-bid" disabled={busy} onClick={onRaise}>
          {busy ? t("bid.sending") : t("paddle.raise", { amount })}
        </button>
      )}
    </section>
  );
}
