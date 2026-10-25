import { TopDonor } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";
import { t } from "../i18n";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => p[0] ?? "").join("");
  return letters.toUpperCase() || "•";
}

export function TopDonorsList(props: { donors: TopDonor[]; ccy: Currency; rising: string[]; youName?: string }) {
  const { donors, ccy, rising, youName } = props;
  if (donors.length === 0) return <p className="g-empty">{t("donate.topEmpty")}</p>;
  const you = youName?.trim().toLowerCase() ?? "";
  const ordered = [...donors].sort((a, b) => {
    const ay = you && a.name.trim().toLowerCase() === you ? 1 : 0;
    const by = you && b.name.trim().toLowerCase() === you ? 1 : 0;
    return by - ay;
  });
  return (
    <ol className="g-top-donors">
      {ordered.map((d) => {
        const mine = you !== "" && d.name.trim().toLowerCase() === you;
        return (
          <li key={`${d.rank}-${d.name}`} className={`tier-${d.tier}${rising.includes(d.name) ? " is-rise" : ""}${mine ? " is-you" : ""}`}>
            <span className="g-donor-rank" aria-hidden="true">{d.rank}</span>
            <span className="g-donor-avatar" aria-hidden="true">{initials(d.name)}</span>
            <strong>{d.name}{mine ? <em>{t("donate.you")}</em> : null}</strong>
            {d.amount != null && <span className="g-donor-amount">{formatAmount(d.amount, ccy)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
