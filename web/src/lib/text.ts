/**
 * Drops the title from the start of a description ("Spa Day for Two – full day incl. lunch"
 * → "full day incl. lunch"; a first line that is just the title disappears). Case, accents and
 * punctuation between the words don't matter. Same rule as the importer (api/src/itemImport.ts).
 */
export function dedupeDescription(title: string, description: string): string {
  const fold = (c: string) => c.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || c;
  const words = fold(title).match(/[\p{L}\p{N}]+/gu);
  const text = (description || "").trim();
  if (!words || !text) return text;
  const lines = text.split("\n");
  const first = [...lines[0]];
  const folded = first.map((c) => (fold(c).length === 1 ? fold(c) : c.toLowerCase())).join("");
  const sep = "[^\\p{L}\\p{N}]*";
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${sep}${words.map(esc).join(sep)}(?![\\p{L}\\p{N}])`, "u").exec(folded);
  if (!m) return text;
  const rest = first.slice([...m[0]].length).join("").replace(/^[\s,;:.\u2013\u2014-]+/, "").trim();
  return [rest, ...lines.slice(1)].filter((l, i) => i > 0 || l).join("\n").trim();
}
