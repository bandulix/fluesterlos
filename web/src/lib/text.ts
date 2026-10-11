const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'", "“": "”", "„": "“", "«": "»", "»": "«", "‘": "’", "‚": "‘", "”": "”" };
const QUOTES = `"'“”„«»‘’‚`;

/**
 * Leftovers from spreadsheet text: a line that is only punctuation/quotes (e.g. the closing `"` of
 * `Chocolate Set "M&Ms galore"` once the title is taken out) is dropped, a line wrapped in quotes
 * loses them, and a single unbalanced quote at the start or end of a line is removed.
 */
export function tidyDescription(text: string): string {
  const out: string[] = [];
  for (const raw of (text || "").split("\n")) {
    let line = raw.trim();
    if (line && !/[\p{L}\p{N}]/u.test(line)) continue;
    for (let i = 0; i < 2; i++) {
      const open = line[0];
      const close = QUOTE_PAIRS[open];
      if (close && line.length > 1 && line.endsWith(close) && !line.slice(1, -1).includes(open) && !line.slice(1, -1).includes(close)) {
        line = line.slice(1, -1).trim();
        continue;
      }
      const count = [...line].filter((c) => QUOTES.includes(c)).length;
      if (count === 1 && QUOTES.includes(line[0])) line = line.slice(1).trim();
      else if (count === 1 && QUOTES.includes(line[line.length - 1])) line = line.slice(0, -1).trim();
      else break;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Drops the title from the start of a description ("Spa Day for Two – full day incl. lunch"
 * → "full day incl. lunch"; a first line that is just the title disappears). Case, accents and
 * punctuation between the words don't matter. Same rule as the importer (api/src/itemImport.ts).
 */
export function dedupeDescription(title: string, description: string): string {
  const fold = (c: string) => c.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || c;
  const words = fold(title).match(/[\p{L}\p{N}]+/gu);
  const text = tidyDescription(description || "");
  if (!words || !text) return text;
  const lines = text.split("\n");
  const first = [...lines[0]];
  const folded = first.map((c) => (fold(c).length === 1 ? fold(c) : c.toLowerCase())).join("");
  const sep = "[^\\p{L}\\p{N}]*";
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${sep}${words.map(esc).join(sep)}(?![\\p{L}\\p{N}])`, "u").exec(folded);
  if (!m) return text;
  const rest = first.slice([...m[0]].length).join("").replace(/^[\s,;:.\u2013\u2014\-"'“”„«»‘’‚]+/, "").trim();
  return tidyDescription([rest, ...lines.slice(1)].filter((l, i) => i > 0 || l).join("\n"));
}
