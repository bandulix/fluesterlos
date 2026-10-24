import { translate, type Lang, type ScreenLang, type StringKey } from "../i18n";

function active(mode: ScreenLang): Lang {
  return mode === "th" || mode === "de" ? mode : "en";
}

/** One phrase, or English with Thai underneath when the host chose both. */
export function Dual({ mode, text }: { mode: ScreenLang; text: (lang: Lang) => string }) {
  if (mode === "both") {
    return (
      <span className="bi">
        <span>{text("en")}</span>
        <small lang="th">{text("th")}</small>
      </span>
    );
  }
  return <>{text(active(mode))}</>;
}

export function Line({ mode, k, vars }: { mode: ScreenLang; k: StringKey; vars?: Record<string, string | number> }) {
  return <Dual mode={mode} text={(lang) => translate(lang, k, vars)} />;
}
