import { en, type StringKey } from "./en";

export type { StringKey };
type Table = Record<StringKey, string>;

/** Registered languages. Add e.g. `th` / `de` here (same keys as en.ts); English is the fallback. */
const TABLES: Record<string, Partial<Table>> = { en };

let lang = "en";
export function setLanguage(code: string) {
  lang = TABLES[code] ? code : "en";
}
export function language() {
  return lang;
}

/** t("bid.button", { amount: "฿2,000" }) → "Bid ฿2,000". Missing keys fall back to English. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const s = TABLES[lang]?.[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : s;
}

/** Count-aware helper: plural("bid.oneBid", "bid.bids", n). */
export function plural(one: StringKey, many: StringKey, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}
