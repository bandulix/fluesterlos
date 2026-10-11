/**
 * Bulk photo / voucher-PDF upload: match files to items by lot number ("03-spa.jpg", "Lot 3.pdf")
 * or by title ("Spa Day.pdf"). Units of a multi-unit lot ("Brunch (1/10)" … "(10/10)") share
 * one photo; a voucher PDF goes to one item only (each unit has its own code).
 */

export type MatchItem = { id: string; title: string; lot: number; kind: "voucher" | "physical" };
export type FileKind = "photo" | "voucher";
export type FileMatch = {
  name: string;
  kind: FileKind | null;
  /** Items the file goes to (photo of a multi-unit lot → all units). Empty = not matched. */
  itemIds: string[];
  how: "lot" | "title" | null;
  note?: string;
};

const PHOTO_EXT = /\.(jpe?g|png|webp|gif)$/i;
const PDF_EXT = /\.pdf$/i;

export function fileKind(name: string, mime = ""): FileKind | null {
  if (mime.startsWith("image/") && /jpeg|png|webp|gif/.test(mime)) return "photo";
  if (mime === "application/pdf") return "voucher";
  if (PHOTO_EXT.test(name)) return "photo";
  if (PDF_EXT.test(name)) return "voucher";
  return null;
}

/** "Exclusive Brunch (3/10)" → "Exclusive Brunch". */
export function baseTitle(title: string): string {
  return title.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
}

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set(["the", "a", "an", "and", "for", "of", "in", "at", "to", "with", "und", "fur", "der", "die", "das", "img", "jpg", "photo", "foto", "voucher", "gutschein", "pdf"]);
const tokens = (s: string) => normName(s).split(" ").filter((t) => t.length >= 2 && !STOP.has(t));

/** Share of the file-name words found in the title (0–1), with a small bonus for prefix matches. */
function score(fileWords: string[], title: string): number {
  if (!fileWords.length) return 0;
  const tw = tokens(title);
  if (!tw.length) return 0;
  let hit = 0;
  for (const w of fileWords) if (tw.some((t) => t === w || (w.length >= 4 && (t.startsWith(w) || w.startsWith(t))))) hit++;
  return hit / fileWords.length;
}

/** Leading lot number with a separator: "03-spa", "3_spa", "Lot 3", "#3", "Nr. 3", "3.jpg". */
const LOT_RE = /^\s*(?:lot|los|nr|no|#)?\s*\.?\s*0*(\d{1,3})(?:\s*[-_.)]\s*|\s*$)/i;

export function matchFile(name: string, items: MatchItem[], mime = ""): FileMatch {
  const kind = fileKind(name, mime);
  if (!kind) return { name, kind, itemIds: [], how: null, note: "Not a photo (jpg, png, webp, gif) or PDF" };
  const stem = name.replace(/\.[a-z0-9]+$/i, "");
  const groupOf = (it: MatchItem) => items.filter((o) => baseTitle(o.title) === baseTitle(it.title) && /\(\d+\/\d+\)$/.test(o.title));

  const finish = (hits: MatchItem[], how: "lot" | "title"): FileMatch => {
    if (kind === "voucher") {
      const vouchers = hits.filter((h) => h.kind === "voucher");
      if (!vouchers.length) return { name, kind, itemIds: [], how: null, note: `“${hits[0].title}” is a physical prize — no PDF needed` };
      if (vouchers.length > 1) {
        return { name, kind, itemIds: [], how: null, note: `${vouchers.length} items match — pick one (each voucher PDF belongs to one item)` };
      }
      return { name, kind, itemIds: [vouchers[0].id], how };
    }
    // Photos: the whole multi-unit lot / all items with that title get the picture.
    const ids = new Set<string>();
    for (const h of hits) {
      ids.add(h.id);
      for (const g of groupOf(h)) ids.add(g.id);
    }
    return { name, kind, itemIds: [...ids], how };
  };

  // 1) Exact title (case/accents/punctuation-insensitive), multi-unit suffix ignored.
  const n = normName(stem);
  const exact = items.filter((it) => normName(baseTitle(it.title)) === n);
  if (exact.length) return finish(exact, "title");

  // 2) Lot number prefix.
  const m = LOT_RE.exec(stem);
  if (m) {
    const lot = Number(m[1]);
    const it = items.find((i) => i.lot === lot);
    if (it) return finish([it], "lot");
  }

  // 3) Best word overlap with a title (unique best, at least half of the file-name words).
  const words = tokens(m ? stem.slice(m[0].length) : stem);
  let best = 0;
  let bestItems: MatchItem[] = [];
  for (const it of items) {
    const s = score(words, baseTitle(it.title));
    if (s > best + 1e-9) {
      best = s;
      bestItems = [it];
    } else if (Math.abs(s - best) < 1e-9 && s > 0) bestItems.push(it);
  }
  if (best >= 0.5 && bestItems.length) {
    const titles = new Set(bestItems.map((i) => baseTitle(i.title)));
    if (titles.size === 1) return finish(bestItems, "title");
    return { name, kind, itemIds: [], how: null, note: `Matches ${titles.size} different items — pick one` };
  }
  return { name, kind, itemIds: [], how: null, note: "No matching item — pick one" };
}

/** Lot numbers as in the export: position in the host list (sort order). */
export function withLots<T extends { id: string; title: string; kind?: "voucher" | "physical" }>(items: T[]): MatchItem[] {
  return items.map((it, i) => ({ id: it.id, title: it.title, lot: i + 1, kind: it.kind ?? "voucher" }));
}

/** "Goes to" choices: a photo can go on any item, a voucher PDF only on voucher items. */
export function targetsFor(kind: FileKind | null, items: MatchItem[]): MatchItem[] {
  if (kind === "voucher") return items.filter((it) => it.kind === "voucher");
  return kind === "photo" ? items : [];
}

/** Footer line under the bulk-media table. */
export function bulkFooter(rows: Array<{ status?: "done" | "error"; itemIds: string[] }>): string {
  if (!rows.length) return "Each item can also get its photo or PDF individually in the list below.";
  const done = rows.filter((r) => r.status === "done");
  const failed = rows.filter((r) => r.status === "error").length;
  const ready = rows.filter((r) => r.status !== "done" && r.itemIds.length > 0).length;
  const unmatched = rows.filter((r) => r.status !== "done" && r.status !== "error" && r.itemIds.length === 0).length;
  const parts: string[] = [];
  if (done.length) {
    const items = done.reduce((n, r) => n + r.itemIds.length, 0);
    parts.push(`✓ ${done.length} file${done.length === 1 ? "" : "s"} uploaded${items > done.length ? ` (${items} items)` : ""}`);
  }
  if (failed) parts.push(`${failed} failed`);
  if (done.length) {
    if (ready) parts.push(`${ready} more ready to upload`);
    if (unmatched) parts.push(`${unmatched} not uploaded (no item chosen)`);
  } else {
    parts.push(`${ready} of ${rows.length} file${rows.length === 1 ? "" : "s"} matched — check the “Goes to” column`);
  }
  return parts.join(" · ");
}
