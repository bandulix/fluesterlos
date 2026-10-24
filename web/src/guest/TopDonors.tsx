import { TopDonor } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";
import { t } from "../i18n";

export function TopDonorsList(props: { donors: TopDonor[]; ccy: Currency; rising: string[] }) {
  const { donors, ccy, rising } = props;
  if (donors.length === 0) return <p className="g-empty">{t("donate.topEmpty")}</p>;
  return (
    <ol className="g-top-donors">
      {donors.map((d) => (
        <li key={`${d.rank}-${d.name}`} className={`tier-${d.tier}${rising.includes(d.name) ? " is-rise" : ""}`}>
          <span className="g-donor-rank" aria-hidden="true">{d.rank}</span>
          <strong>{d.name}</strong>
          {d.amount != null && <span className="g-donor-amount">{formatAmount(d.amount, ccy)}</span>}
        </li>
      ))}
    </ol>
  );
}
