import { en, type StringKey } from "./en";
import { th } from "./th";
import { de } from "./de";

export type { StringKey };
export type Lang = "en" | "th" | "de";
/** Big-screen language. `both` is English with a Thai line under each phrase. */
export type ScreenLang = Lang | "both";

type Table = Record<StringKey, string>;

const TABLES: Record<Lang, Table> = { en, th, de };
export const LANG_STORAGE_KEY = "fl_lang";

let lang: Lang = "en";
const listeners = new Set<() => void>();

/** th* → Thai, de* → German, everything else stays English. */
export function detectLanguage(navLang: string | null | undefined): Lang {
  const code = (navLang || "").toLowerCase();
  if (code.startsWith("th")) return "th";
  if (code.startsWith("de")) return "de";
  return "en";
}

function readStored(): Lang | null {
  try {
    const raw = globalThis.localStorage?.getItem(LANG_STORAGE_KEY);
    if (raw === "en" || raw === "th" || raw === "de") return raw;
  } catch {
    /* private mode, or no storage in tests */
  }
  return null;
}

/**
 * Device language for guest screens. A saved choice wins; otherwise the browser language.
 * The big screen does not use this — it follows the host's event setting.
 */
export function initLanguage(navLang?: string | null): Lang {
  const stored = readStored();
  const detected =
    navLang !== undefined
      ? detectLanguage(navLang)
      : detectLanguage(typeof navigator !== "undefined" ? navigator.language : "en");
  lang = stored ?? detected;
  return lang;
}

export function setLanguage(code: string) {
  const next: Lang = code === "th" || code === "de" ? code : "en";
  lang = next;
  try {
    globalThis.localStorage?.setItem(LANG_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function language(): Lang {
  return lang;
}

export function asScreenLang(value: string | null | undefined): ScreenLang {
  if (value === "th" || value === "de" || value === "both") return value;
  return "en";
}

/** Translate for an explicit language. Unknown codes fall back to English. */
export function translate(code: string, key: StringKey, vars?: Record<string, string | number>): string {
  const table = code === "th" || code === "de" ? TABLES[code] : en;
  const s = table[key] ?? en[key] ?? key;
  return applyVars(s, vars);
}

/** t("bid.button", { amount: "฿2,000" }) → "Bid ฿2,000". Missing keys fall back to English. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  return translate(lang, key, vars);
}

function applyVars(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : s;
}

/** Count-aware helper: plural("bid.oneBid", "bid.bids", n). */
export function plural(one: StringKey, many: StringKey, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

export function countLabel(code: string, one: StringKey, many: StringKey, n: number): string {
  return translate(code, n === 1 ? one : many, { n });
}

/** The server's unnamed label. Replaced on screen so it follows the language. */
export const SERVER_GUEST = "A guest";
/** Unnamed paddle on the big screen. The API always sends this English string. */
export const SERVER_GENEROUS = "A generous guest";

export function guestLabel(name: string | null | undefined, code: string, anonymous = false): string {
  if (anonymous || !name || name === SERVER_GUEST) return translate(code, "screen.guest");
  return name;
}
