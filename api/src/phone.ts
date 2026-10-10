import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Default region for numbers typed without a country code (e.g. 081-234-5678 → +66812345678). */
export function defaultPhoneCountry(): CountryCode {
  return ((process.env.DEFAULT_PHONE_COUNTRY || "TH").toUpperCase() as CountryCode);
}

/** Returns the E.164 form, or null when the input is not a valid phone number. */
export function normalizePhone(raw: string): string | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(input, defaultPhoneCountry());
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Board-safe label: never show the full number publicly. */
export function phoneTail(e164: string | null | undefined): string {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}

export function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  const l = local.length <= 2 ? `${local[0] ?? ""}*` : `${local.slice(0, 2)}***`;
  return `${l}@${domain}`;
}

/**
 * Spreadsheet-friendly phone for CSV: national format for the default country ("081 234 5678"),
 * otherwise "(+49) 151 23456789". Never starts with + / = / - / @, so no formula prefix is needed.
 */
export function csvPhone(e164: string): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164.replace(/^\+/, "");
  if (parsed.country === defaultPhoneCountry()) return parsed.formatNational();
  return parsed.formatInternational().replace(/^\+(\d+)\s*/, "(+$1) ");
}
