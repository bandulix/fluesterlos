import { setLanguage, t, type Lang } from "../i18n";
import { useLang } from "../i18n/react";

const CHOICES: { code: Lang; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "th", label: "ไทย" },
  { code: "de", label: "DE" },
];

/** EN / ไทย / DE. The choice is stored on this device. */
export function LangSwitch() {
  const lang = useLang();
  return (
    <div className="g-lang" role="group" aria-label={t("lang.label")}>
      {CHOICES.map((c) => (
        <button
          key={c.code}
          type="button"
          aria-pressed={lang === c.code}
          className={lang === c.code ? "is-on" : ""}
          onClick={() => setLanguage(c.code)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
