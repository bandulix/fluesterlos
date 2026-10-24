import { FormEvent, useState } from "react";
import { assetUrl, Need } from "../lib/api";
import { Currency, formatAmount } from "../lib/money";
import { anonymousGiftLabel, stepUnits, unitsCost } from "../lib/pledgeLogic";
import { dedupeDescription } from "../lib/text";
import { plural, t } from "../i18n";

function fundedPercent(n: { percent: number }): string {
  const shown = Number.isInteger(n.percent) ? String(n.percent) : n.percent.toFixed(1);
  return t("donate.percent", { n: shown });
}

/** Guest-facing progress. The API label stays English for the host. */
function fundedText(n: { percent: number; fullyFunded: boolean; overFunded: boolean }): string {
  if (n.overFunded) return `${t("donate.funded")} · ${fundedPercent(n)}`;
  if (n.fullyFunded) return t("donate.funded");
  return fundedPercent(n);
}

export type PledgeDraft = {
  amount?: number;
  units?: number;
  namedPublicly: boolean;
  publicName?: string;
  showAmount?: boolean;
};

export function NeedCard(props: {
  need: Need;
  ccy: Currency;
  expanded: boolean;
  busy: boolean;
  myAmount: number;
  justFunded: boolean;
  guestName: string;
  recognitionOn: boolean;
  initialName?: { namedPublicly: boolean; publicName: string; showAmount: boolean };
  onToggle: () => void;
  onPledge: (draft: PledgeDraft) => void;
}) {
  const { need: n, ccy, expanded, busy, myAmount, justFunded, guestName, recognitionOn, initialName, onToggle, onPledge } = props;
  const fmt = (v: number) => formatAmount(v, ccy);
  const hasUnits = n.unitAmount != null && n.unitAmount > 0 && !!n.unitLabel;
  const [units, setUnits] = useState(1);
  const [preset, setPreset] = useState<number | null>(hasUnits ? null : (n.suggestedAmounts[0] ?? null));
  const [custom, setCustom] = useState("");
  const [named, setNamed] = useState(initialName?.namedPublicly ?? false);
  const [publicName, setPublicName] = useState(initialName?.publicName || guestName);
  const [showAmount, setShowAmount] = useState(initialName?.showAmount ?? false);
  const description = dedupeDescription(n.title, n.description);
  const usingCustom = custom.trim() !== "";
  const amount = usingCustom
    ? Number(custom)
    : preset != null
      ? preset
      : hasUnits
        ? unitsCost(units, n.unitAmount!)
        : NaN;
  const amountOk = Number.isFinite(amount) && amount + 0.001 >= n.minPledge;
  const remaining = Math.max(0, Math.round((n.targetAmount - n.raised) * 100) / 100);
  const blockedByCap = n.capAtTarget && (remaining <= 0 || (amountOk && amount > remaining + 0.001));
  const canPledge = n.open && amountOk && !blockedByCap && !busy;

  function choosePreset(value: number) {
    setPreset(value);
    setCustom("");
  }

  function onUnits(dir: 1 | -1) {
    setUnits((u) => stepUnits(u, dir));
    setPreset(null);
    setCustom("");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canPledge) return;
    const naming = recognitionOn
      ? { namedPublicly: named, publicName: named ? publicName.trim() || guestName : undefined, showAmount: named && showAmount }
      : { namedPublicly: false as const };
    if (!usingCustom && preset == null && hasUnits) onPledge({ units, ...naming });
    else onPledge({ amount, ...naming });
  }

  return (
    <article className={`g-item g-need${n.fullyFunded ? " is-funded" : ""}${justFunded ? " is-celebrate" : ""}`} aria-labelledby={`need-${n.id}-title`}>
      <div className="g-item-media">
        {n.photoUrl ? (
          <img src={assetUrl(n.photoUrl)} alt="" />
        ) : (
          <div className="g-item-placeholder" aria-hidden="true">🎁</div>
        )}
        {n.example && <span className="g-kind">{t("donate.example")}</span>}
      </div>
      <div className="g-item-body">
        <p className="g-kicker">{n.beneficiary}</p>
        <h2 id={`need-${n.id}-title`}>{n.title}</h2>
        {description && <p className="g-desc">{description}</p>}
        <div
          className="g-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(n.barPercent)}
          aria-label={fundedText(n)}
        >
          <span style={{ width: `${n.barPercent}%` }} />
        </div>
        <div className="g-fund-meta">
          <strong>{fmt(n.raised)}</strong>
          <span>
            {fundedText(n)} · {fmt(n.targetAmount)} · {plural("donate.oneDonor", "donate.donors", n.donorCount)}
          </span>
        </div>
        {n.fullyFunded && (
          <p className={`g-funded${justFunded ? " is-new" : ""}`} role="status">
            <span aria-hidden="true">★</span> {t("donate.funded")}
            {n.overFunded && <small>{fundedPercent(n)}</small>}
          </p>
        )}
        {myAmount > 0 && <p className="g-yours-pledge">{t("donate.yours", { amount: fmt(myAmount) })}</p>}
        {recognitionOn && <SupportedBy need={n} fmt={fmt} />}
        {!expanded ? (
          <button type="button" className="g-bid" onClick={onToggle} disabled={!n.open && myAmount === 0}>
            {n.open ? t("donate.pledge") : t("donate.closed")}
          </button>
        ) : (
          <form className="g-pledge-form" onSubmit={submit}>
            {!n.open && <p className="g-info">{t("donate.closed")}</p>}
            {n.open && n.capAtTarget && remaining <= 0 && <p className="g-info">{t("donate.capped")}</p>}
            {n.open && !(n.capAtTarget && remaining <= 0) && (
              <>
                {n.endsAt ? (
                  <p className="g-muted g-small">{t("donate.until", { time: new Date(n.endsAt).toLocaleString() })}</p>
                ) : (
                  <p className="g-muted g-small">{t("donate.open")}</p>
                )}
                {hasUnits && (
                  <div className="g-stepper" role="group" aria-label={n.unitLabel!}>
                    <button type="button" className="g-step" aria-label={t("donate.less")} onClick={() => onUnits(-1)} disabled={units <= 1}>
                      −
                    </button>
                    <span className="g-step-amount">
                      {units} {units === 1 ? n.unitLabel : `${n.unitLabel}s`}
                      <small>{fmt(unitsCost(units, n.unitAmount!))}</small>
                    </span>
                    <button type="button" className="g-step" aria-label={t("donate.more")} onClick={() => onUnits(1)}>
                      +
                    </button>
                  </div>
                )}
                {n.suggestedAmounts.length > 0 && (
                  <div className="g-presets" role="group" aria-label={t("donate.pledge")}>
                    {n.suggestedAmounts.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`g-preset${preset === v && !usingCustom ? " is-active" : ""}`}
                        aria-pressed={preset === v && !usingCustom}
                        onClick={() => choosePreset(v)}
                      >
                        {fmt(v)}
                      </button>
                    ))}
                  </div>
                )}
                <label className="g-field-label" htmlFor={`custom-${n.id}`}>{t("donate.custom")}</label>
                <input
                  id={`custom-${n.id}`}
                  className="g-big-input"
                  inputMode="decimal"
                  value={custom}
                  placeholder={fmt(n.minPledge)}
                  onChange={(e) => {
                    setCustom(e.target.value.replace(/[^0-9.]/g, ""));
                    setPreset(null);
                  }}
                />
                <p className="g-muted g-small">{t("donate.min", { amount: fmt(n.minPledge) })}</p>
                {recognitionOn && (
                  <div className="g-naming">
                    <label className="g-anon">
                      <input type="checkbox" checked={named} onChange={(e) => {
                        const on = e.target.checked;
                        setNamed(on);
                        if (on && !publicName.trim()) setPublicName(guestName);
                      }} />
                      {t("donate.nameMe")}
                    </label>
                    {named ? (
                      <>
                        <label className="g-field-label" htmlFor={`pub-${n.id}`}>{t("donate.publicName")}</label>
                        <input
                          id={`pub-${n.id}`}
                          className="g-big-input"
                          value={publicName}
                          maxLength={80}
                          onChange={(e) => setPublicName(e.target.value)}
                        />
                        <p className="g-muted g-small">{t("donate.publicHint")}</p>
                        <label className="g-anon">
                          <input type="checkbox" checked={showAmount} onChange={(e) => setShowAmount(e.target.checked)} />
                          {t("donate.showAmount")}
                        </label>
                      </>
                    ) : (
                      <p className="g-muted g-small">{t("donate.asGuest")}</p>
                    )}
                  </div>
                )}
                <button className="g-bid" disabled={!canPledge}>
                  {busy ? t("bid.sending") : t("donate.confirm", { amount: amountOk ? fmt(amount) : "" })}
                </button>
              </>
            )}
            <button type="button" className="g-link" onClick={onToggle}>
              {t("name.dismiss")}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function SupportedBy({ need, fmt }: { need: Need; fmt: (n: number) => string }) {
  const donors = need.supporters ?? [];
  const anon = need.anonymousGifts ?? 0;
  if (donors.length === 0 && anon === 0) return null;
  return (
    <div className="g-supported">
      <p className="g-kicker">{t("donate.supported")}</p>
      {donors.length > 0 && (
        <ul>
          {donors.map((d) => (
            <li key={d.name}>
              <span>{d.name}</span>
              {d.amount != null && <strong>{fmt(d.amount)}</strong>}
            </li>
          ))}
        </ul>
      )}
      {anon > 0 && <p className="g-muted g-small">{anonymousGiftLabel(anon)}</p>}
    </div>
  );
}
