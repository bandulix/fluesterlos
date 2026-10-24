import { FormEvent, useState } from "react";
import { t } from "../i18n";

export function RecognitionEditor(props: {
  guestName: string;
  namedPublicly: boolean;
  publicName: string;
  showAmount: boolean;
  hiddenByHost: boolean;
  busy: boolean;
  onSave: (draft: { namedPublicly: boolean; publicName: string; showAmount: boolean }) => void;
}) {
  const [named, setNamed] = useState(props.namedPublicly);
  const [publicName, setPublicName] = useState(props.publicName || props.guestName);
  const [showAmount, setShowAmount] = useState(props.showAmount);

  function submit(e: FormEvent) {
    e.preventDefault();
    props.onSave({
      namedPublicly: named,
      publicName: named ? publicName.trim() || props.guestName : publicName,
      showAmount: named && showAmount,
    });
  }

  return (
    <form className="g-recognition" onSubmit={submit}>
      <p className="g-kicker">{t("donate.recognition")}</p>
      {props.hiddenByHost && <p className="g-info">{t("donate.hiddenByHost")}</p>}
      <label className="g-anon">
        <input type="checkbox" checked={named} onChange={(e) => {
          const on = e.target.checked;
          setNamed(on);
          if (on && !publicName.trim()) setPublicName(props.guestName);
        }} />
        {t("donate.nameMe")}
      </label>
      {named ? (
        <>
          <label className="g-field-label" htmlFor="mine-public-name">{t("donate.publicName")}</label>
          <input id="mine-public-name" className="g-big-input" value={publicName} maxLength={80} onChange={(e) => setPublicName(e.target.value)} />
          <label className="g-anon">
            <input type="checkbox" checked={showAmount} onChange={(e) => setShowAmount(e.target.checked)} />
            {t("donate.showAmount")}
          </label>
        </>
      ) : (
        <p className="g-muted g-small">{t("donate.asGuest")}</p>
      )}
      <button className="g-bid" disabled={props.busy}>{props.busy ? t("bid.sending") : t("donate.recognitionSave")}</button>
    </form>
  );
}
