/**
 * Phone field auto-format while typing (Thai default). Purely cosmetic: the server normalises
 * whatever is sent (libphonenumber), so we never block a number we don't recognise.
 */

function group(digits: string, sizes: number[]): string {
  const out: string[] = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + size));
    i += size;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(" ");
}

export function phoneDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function formatPhoneInput(raw: string): string {
  const s = String(raw ?? "").trim();
  const plus = s.startsWith("+") || s.startsWith("00");
  let d = phoneDigits(s);
  if (s.startsWith("00")) d = d.slice(2);
  if (plus) {
    if (d.startsWith("66")) {
      const nat = d.slice(2, 11);
      return nat ? `+66 ${nat.startsWith("2") ? group(nat, [1, 3, 4]) : group(nat, [2, 3, 4])}` : "+66";
    }
    return d ? `+${d.slice(0, 15)}` : "+";
  }
  if (d.startsWith("0")) {
    // 02 xxx xxxx (Bangkok landline) or 0xx xxx xxxx (mobile)
    return d[1] === "2" ? group(d.slice(0, 9), [2, 3, 4]) : group(d.slice(0, 10), [3, 3, 4]);
  }
  return group(d.slice(0, 15), [2, 3, 4]);
}

/** Enough digits to be worth sending (the server does the real validation). */
export function phoneLooksComplete(raw: string): boolean {
  const s = String(raw ?? "").trim();
  const d = phoneDigits(s);
  if (s.startsWith("+") || s.startsWith("00")) return d.length >= 8;
  if (d.startsWith("0")) return d[1] === "2" ? d.length >= 9 : d.length >= 10;
  return d.length >= 9;
}
