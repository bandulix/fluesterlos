/**
 * Item import from a host's spreadsheet (.xlsx / .csv), designed around a typical charity-gala
 * "Prizes" workbook: one row per lot, free-text description, sponsor + "organized by" columns,
 * approximate value, suggested minimum, results columns from last year (ignored), plus one
 * printed bid sheet per lot ("Liste N") that carries the prize photo and sponsor logo.
 *
 * Everything here is pure (no DB): parse → raw table, auto-map headers, normalize rows with
 * per-row issues, apply host overrides, expand multi-unit lots into item drafts.
 */
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";

export const IMPORT_FIELDS = [
  "lot",
  "title",
  "description",
  "kind",
  "sponsor",
  "organizer",
  "retailValue",
  "startingBid",
  "increment",
  "buyNow",
  "quantity",
  "notes",
  "ignore",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  lot: "Lot no.",
  title: "Title",
  description: "Description",
  kind: "Type (voucher / physical)",
  sponsor: "Sponsor",
  organizer: "Organized by (notes)",
  retailValue: "Retail value",
  startingBid: "Starting bid",
  increment: "Increment",
  buyNow: "Buy now",
  quantity: "Quantity",
  notes: "Notes",
  ignore: "Don't import",
};

/** A cell as read from the file: text or number, plus a spreadsheet error such as #VALUE!. */
export type Cell = { v: string | number | null; err?: string };
export type RawRow = { rowNumber: number; cells: Cell[] };
export type ExtractedImage = { name: string; ext: string; buffer: Buffer; hash: string };
export type RawTable = {
  sheetName: string;
  /** Other sheets that were not read (bid sheets etc.). */
  skippedSheets: string[];
  headerRow: number;
  headers: string[];
  rows: RawRow[];
  /** rowNumber → extracted images (photo of the prize, logo of the sponsor). */
  images: Record<number, { photo?: ExtractedImage; logo?: ExtractedImage }>;
};

/** column index → field (null = not used). */
export type Mapping = Array<ImportField | null>;

export type IssueLevel = "error" | "warning" | "info";
export type Issue = { level: IssueLevel; message: string; field?: ImportField };

export type ImportRow = {
  /** Spreadsheet row number: stable key for overrides. */
  key: number;
  lot: string | null;
  title: string;
  description: string;
  kind: "voucher" | "physical";
  kindGuessed: boolean;
  sponsor: string | null;
  retailValue: number | null;
  startingBid: number | null;
  increment: number | null;
  buyNow: number | null;
  quantity: number;
  notes: string;
  /** Marked as sold at a fixed price / not auctioned: host decides (skip, or Buy-now-only item). */
  fixedPrice: boolean;
  skip: boolean;
  hasPhoto: boolean;
  hasLogo: boolean;
  issues: Issue[];
};

export type RowOverride = {
  skip?: boolean;
  kind?: "voucher" | "physical";
  title?: string;
  startingBid?: number | null;
  increment?: number | null;
  buyNow?: number | null;
};

export type ItemDraft = {
  key: number;
  title: string;
  description: string;
  kind: "voucher" | "physical";
  sponsor: string | null;
  retailValue: number | null;
  startingBid: number;
  increment: number;
  buyNow: number | null;
  notes: string;
};

// ————————————————————————————————————————— reading files

const PREFERRED_SHEET = /^prizes?$|^preise$|^items$|^lots?$|^gewinne$/i;
/** Printed paper bid sheets: never the item list. */
const BID_SHEET = /^(liste|list|bid ?sheet|bieterliste|gebotsliste|sheet)\s*\d+$/i;

function cellFromExcel(value: ExcelJS.CellValue): Cell {
  if (value == null) return { v: null };
  if (typeof value === "number") return { v: Number.isFinite(value) ? value : null };
  if (typeof value === "string") return { v: value };
  if (typeof value === "boolean") return { v: value ? "TRUE" : "FALSE" };
  if (value instanceof Date) return { v: value.toISOString().slice(0, 10) };
  const o = value as unknown as Record<string, unknown>;
  if (typeof o.error === "string") return { v: null, err: o.error };
  if (Array.isArray(o.richText)) return { v: (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("") };
  if ("formula" in o || "sharedFormula" in o) {
    const r = o.result as ExcelJS.CellValue | undefined;
    if (r === undefined) return { v: null };
    return cellFromExcel(r);
  }
  if (typeof o.text === "string") return { v: o.text }; // hyperlink
  return { v: String(value) };
}

const isEmpty = (c: Cell | undefined) => !c || c.err == null && (c.v == null || (typeof c.v === "string" && c.v.trim() === ""));

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

type Rule = { field: ImportField; re: RegExp };
/** Order matters: the first rule that matches wins. */
const HEADER_RULES: Rule[] = [
  // Last year's results and buyer columns: never imported (and they hold personal data).
  { field: "ignore", re: /final price|price achieved|achieved|bought by|buyer|winner|money received|received|payment|handed over|^paid$|kaufer|bezahlt|zuschlag|erzielt|gewinner|ersteigert/ },
  { field: "lot", re: /^(no|nr|#|lot|lot #|lot no|lot nr|lot number|number|nummer|los|los nr|losnummer|item no|item #|nr #|no #|pos|position)$/ },
  { field: "quantity", re: /^(qty|quantity|anzahl|menge|count|pieces|stuck|stueck|pcs|units)$|quantity|anzahl|menge/ },
  { field: "increment", re: /increment|steps?\b|schritt|erhohung|erhoehung|steigerung/ },
  { field: "buyNow", re: /buy ?now|buy it now|fixed price|festpreis|sofortkauf|sofort kaufen/ },
  { field: "startingBid", re: /minimum|starting|start ?bid|start ?price|min bid|mindest|startgebot|startpreis|opening bid|reserve/ },
  { field: "retailValue", re: /value|wert|rrp|retail|msrp|worth|listenpreis|neupreis/ },
  { field: "organizer", re: /organi[sz]ed|organi[sz]er|contact|ansprechpartner|betreut|organisiert|responsible|zustandig|volunteer/ },
  { field: "sponsor", re: /sponsor|donor|donated|spender|gespendet|stifter|company|firma|unternehmen/ },
  { field: "kind", re: /^(type|kind|typ|art|category|kategorie|item type)$/ },
  { field: "notes", re: /remark|note|comment|bemerkung|notiz|anmerkung|kommentar|hinweis/ },
  { field: "title", re: /^(title|titel|item|item name|prize|prize name|name|bezeichnung|artikel|gewinn|headline|lot title)$/ },
  { field: "description", re: /description|beschreibung|details|^desc$|^text$/ },
];

export function matchHeader(header: string): ImportField | null {
  const h = norm(header);
  if (!h) return null;
  for (const r of HEADER_RULES) if (r.re.test(h)) return r.field;
  return null;
}

/** Auto-detect: each field is used once (first matching column wins). */
export function autoMapping(headers: string[]): Mapping {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const f = matchHeader(h);
    if (!f) return null;
    if (f === "ignore") return "ignore";
    if (used.has(f)) return null;
    used.add(f);
    return f;
  });
}

function detectHeaderRow(grid: Cell[][]): number {
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const fields = grid[i].map((c) => (typeof c.v === "string" ? matchHeader(c.v) : null)).filter((f) => f && f !== "ignore");
    const score = new Set(fields).size;
    const hasText = fields.includes("title") || fields.includes("description");
    if (hasText && score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function tableFromGrid(grid: Cell[][], rowNumbers: number[]): { headerRow: number; headers: string[]; rows: RawRow[] } {
  const h = detectHeaderRow(grid);
  if (h < 0) {
    throw Object.assign(new Error("Couldn't find a header row with a title or description column. Use the template, or name the columns e.g. “Title”, “Description”, “Starting bid”."), { statusCode: 400 });
  }
  const width = Math.max(...grid.slice(h).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(grid[h][i]?.v ?? "").replace(/\s+/g, " ").trim());
  const rows: RawRow[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const cells = Array.from({ length: width }, (_, c) => grid[i][c] ?? { v: null });
    if (cells.every((c) => isEmpty(c))) continue;
    rows.push({ rowNumber: rowNumbers[i], cells });
  }
  return { headerRow: rowNumbers[h], headers, rows };
}

function sha(buf: Buffer) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 12);
}

/**
 * Pick the item sheet: "Prizes" (or a similar name) if present, else the first sheet that isn't a
 * printed bid sheet ("Liste 1" …).
 */
export function pickSheet(names: string[]): string | null {
  return names.find((n) => PREFERRED_SHEET.test(n.trim())) ?? names.find((n) => !BID_SHEET.test(n.trim())) ?? names[0] ?? null;
}

export async function parseXlsx(buffer: Buffer): Promise<RawTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw Object.assign(new Error("This file can't be read as an Excel workbook (.xlsx). Save it as .xlsx or .csv and try again."), { statusCode: 400 });
  }
  const names = wb.worksheets.map((w) => w.name);
  const sheetName = pickSheet(names);
  const ws = sheetName ? wb.getWorksheet(sheetName) : undefined;
  if (!ws) throw Object.assign(new Error("The workbook has no sheets."), { statusCode: 400 });
  const grid: Cell[][] = [];
  const rowNumbers: number[] = [];
  const last = ws.rowCount;
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) cells.push(cellFromExcel(row.getCell(c).value));
    while (cells.length && isEmpty(cells[cells.length - 1])) cells.pop();
    grid.push(cells);
    rowNumbers.push(r);
  }
  const t = tableFromGrid(grid, rowNumbers);
  const images = extractImages(wb, ws, t.rows.map((r) => r.rowNumber));
  return { sheetName: ws.name, skippedSheets: names.filter((n) => n !== ws.name), ...t, images };
}

/**
 * Embedded pictures. Two layouts are understood:
 * - a picture placed on the item row of the item sheet → photo of that row;
 * - one printed bid sheet per lot whose cells reference the item sheet (=Prizes!D4): the largest
 *   picture is the prize photo, a picture next to a "Logo" label is the sponsor logo. A logo that
 *   shows up for different sponsors is the organiser's own logo and is ignored.
 */
function extractImages(wb: ExcelJS.Workbook, itemSheet: ExcelJS.Worksheet, dataRows: number[]): RawTable["images"] {
  const out: RawTable["images"] = {};
  const rowSet = new Set(dataRows);
  const media = (id: number | string): ExtractedImage | null => {
    try {
      const m = wb.getImage(Number(id)) as unknown as { buffer?: Buffer; extension?: string };
      if (!m?.buffer || !m.extension) return null;
      const ext = m.extension.toLowerCase() === "jpg" ? "jpeg" : m.extension.toLowerCase();
      if (!["jpeg", "png", "gif", "webp"].includes(ext)) return null;
      const buffer = Buffer.from(m.buffer);
      const hash = sha(buffer);
      return { name: `${hash}.${ext === "jpeg" ? "jpg" : ext}`, ext, buffer, hash };
    } catch {
      return null;
    }
  };

  for (const img of itemSheet.getImages()) {
    const row = Math.floor(img.range.tl.nativeRow) + 1;
    const im = media(img.imageId);
    if (im && rowSet.has(row)) {
      const cur = out[row]?.photo;
      if (!cur || im.buffer.length > cur.buffer.length) out[row] = { ...out[row], photo: im };
    }
  }

  const ref = new RegExp(`'?${itemSheet.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?!\\$?[A-Z]{1,3}\\$?(\\d+)`, "i");
  const logoCandidates: Array<{ row: number; im: ExtractedImage }> = [];
  for (const ws of wb.worksheets) {
    if (ws === itemSheet) continue;
    const imgs = ws.getImages();
    if (!imgs.length) continue;
    const counts = new Map<number, number>();
    let logoCell: { row: number; col: number } | null = null;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const v = cell.value as unknown as { formula?: string; sharedFormula?: string } | string | null;
        const f = v && typeof v === "object" ? v.formula ?? v.sharedFormula : undefined;
        const m = f ? ref.exec(f) : null;
        if (m) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
        if (typeof v === "string" && /^\s*logos?\s*$/i.test(v)) logoCell = { row: rn - 1, col: cn - 1 };
      });
    });
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!target || !rowSet.has(target)) continue;
    const lc = logoCell as { row: number; col: number } | null;
    let photo: ExtractedImage | null = null;
    for (const img of imgs) {
      const im = media(img.imageId);
      if (!im) continue;
      const nearLogo = lc && Math.abs(img.range.tl.nativeCol - lc.col) <= 1 && Math.abs(img.range.tl.nativeRow - lc.row) <= 2;
      if (nearLogo) logoCandidates.push({ row: target, im });
      else if (!photo || im.buffer.length > photo.buffer.length) photo = im;
    }
    if (photo && !out[target]?.photo) out[target] = { ...out[target], photo };
  }
  // Logos that appear on several rows are kept only if all those rows share one sponsor — decided
  // later with the sponsor column (see normalizeRows); here: first logo per row.
  for (const { row, im } of logoCandidates) if (!out[row]?.logo) out[row] = { ...out[row], logo: im };
  return out;
}

/** Minimal RFC-4180 CSV reader; delimiter , ; or tab (auto-detected); UTF-8 with or without BOM. */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(buffer: Buffer): RawTable {
  const grid: Cell[][] = parseCsvText(buffer.toString("utf8")).map((r) =>
    r.map((s) => {
      const t = s.trim();
      return /^#(VALUE|REF|DIV\/0|N\/A|NAME|NUM|NULL)[!?]?$/i.test(t) ? { v: null, err: t.toUpperCase() } : { v: s };
    }),
  );
  const t = tableFromGrid(grid, grid.map((_, i) => i + 1));
  return { sheetName: "CSV", skippedSheets: [], ...t, images: {} };
}

export async function parseImportFile(filename: string, buffer: Buffer): Promise<RawTable> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || buffer.subarray(0, 2).toString() === "PK") return parseXlsx(buffer);
  if (lower.endsWith(".xls")) {
    throw Object.assign(new Error("Old .xls files aren't supported — open it in Excel and save as .xlsx (or .csv)."), { statusCode: 400 });
  }
  return parseCsv(buffer);
}

// ————————————————————————————————————————— values

const FIXED_PRICE = /sold|not auctioned|fixed ?price|festpreis|verkauft|nicht versteigert|direktverkauf/i;

export type Amount = { value: number | null; issue?: string; fixed?: boolean };

/** "2.500", "THB 1,250", "฿1,250.00", "1'250", ">10.000", 2500 → numbers. */
export function parseAmount(cell: Cell | undefined): Amount {
  if (!cell) return { value: null };
  if (cell.err) return { value: null, issue: `shows ${cell.err} — ignored` };
  if (cell.v == null) return { value: null };
  if (typeof cell.v === "number") return cell.v >= 0 ? { value: round2(cell.v) } : { value: null, issue: `is negative (${cell.v}) — ignored` };
  const raw = cell.v.trim();
  if (!raw) return { value: null };
  if (FIXED_PRICE.test(raw)) return { value: null, fixed: true, issue: `says “${clip(raw, 40)}”` };
  let s = raw
    .replace(/thb|baht|bht|฿|eur|€|usd|us\$|\$|chf|approx\.?|ca\.?|about|~|>|<|≈/gi, "")
    .replace(/[\s'’]/g, "")
    .replace(/[,.]-$/, "");
  if (!/^\d[\d.,]*$/.test(s)) return { value: null, issue: `“${clip(raw, 40)}” is not a number — ignored` };
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep) {
      const parts = s.split(sep);
      const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
      s = thousands ? parts.join("") : parts.join(".");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? { value: round2(n) } : { value: null, issue: `“${clip(raw, 40)}” is not a number — ignored` };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Keeps line breaks (descriptions are multi-line), tidies spaces, at most one blank line. */
const multiLine = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Rounded to a "nice" amount: 1,000+ → 100s, 100+ → 10s, 10+ → 5s, else whole. */
export function niceRound(n: number): number {
  const step = n >= 1000 ? 100 : n >= 100 ? 10 : n >= 10 ? 5 : 1;
  return Math.max(step, Math.round(n / step) * step);
}

/** Last year's sheets: "Minimum Steps = E11/10" → 10 % of the starting bid, rounded sensibly. */
export function defaultIncrement(startingBid: number): number {
  const raw = startingBid / 10;
  if (Number.isInteger(raw)) return Math.max(1, raw);
  const step = raw >= 100 ? 10 : raw >= 10 ? 5 : 1;
  return Math.max(1, Math.round(raw / step) * step);
}

/** Starting bid when only the value is known: ~20 % of the value (last year's typical ratio). */
export function defaultStartingBid(retailValue: number): number {
  return niceRound(retailValue * 0.2);
}

const VOUCHER_WORDS =
  /\b(vouchers?|gutscheins?|gift ?cards?|hotels?|resorts?|spa|restaurants?|brunch|dinner|lunch|breakfast|nights?|nacht|n[aä]chte|[uü]bernachtung(en)?|stay|massages?|onsen|wellness|golf|bay|tickets?|flights?|fl[uü]ge?|class(es)?|course|kurs|lessons?|treatments?|therapy|experience|erlebnis|bar|caf[eé]|suite|villa|room|tour|cruise|cooking|tasting|menu|men[uü])\b/i;

export function guessKind(text: string): "voucher" | "physical" {
  return VOUCHER_WORDS.test(text) ? "voucher" : "physical";
}

function parseKind(v: string): "voucher" | "physical" | null {
  const s = norm(v);
  if (!s) return null;
  if (/^(v|voucher|vouchers|gutschein|gutscheine|coupon|gift card|e voucher|evoucher|service|experience)$/.test(s)) return "voucher";
  if (/^(p|physical|physisch|item|object|goods|ware|sachpreis|sachspende|abholung|pickup|collect|collect at desk|product|produkt)$/.test(s)) return "physical";
  return null;
}

/** "10x", "10 x", "x10", "10×" — a quantity. */
const QTY_CELL = /^\s*(?:(\d{1,3})\s*[x×]|[x×]\s*(\d{1,3}))\s*$/i;
const QTY_PREFIX = /^\s*(\d{1,3})\s*[x×]\s+(?=\S)/i;
export const MAX_QUANTITY = 50;

/**
 * Title from a description-only sheet: the first line, without a trailing "(dates …)" or
 * "retail value THB …" part, at most ~80 characters.
 */
export function titleFromDescription(desc: string): string {
  const first = (desc.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  let t = oneLine(first)
    .replace(/,?\s*(with an? )?(approx\.?|approximate )?(retail )?value( of)?\s*(thb|฿|eur|€|usd|\$)?\s*[>~]?\s*[\d.,]+.*$/i, "")
    .trim();
  // A trailing "(16MAR - 31OCT 2026)" / "(Sunday-Friday …)" stays in the description.
  const paren = /\s*\([^)]*\d[^)]*\)?\s*$/.exec(t);
  if (paren && paren.index >= 15) t = t.slice(0, paren.index).trim();
  if (t.length > 80 && t.indexOf(" (") > 15) t = t.slice(0, t.indexOf(" (")).trim();
  if (t.length > 80) {
    const cut = t.slice(0, 80);
    t = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\-–]+$/, "")}…`;
  }
  return t.replace(/[,;:]+$/, "").trim();
}

function text(cell: Cell | undefined): string {
  if (!cell || cell.v == null) return "";
  return typeof cell.v === "number" ? String(cell.v) : cell.v;
}

// ————————————————————————————————————————— rows

/**
 * Turns the raw table into preview rows. `existingSponsors` (lower-cased names) only affects the
 * "new sponsor" info. Total rows (numbers but no text, e.g. =SUM(…)) are dropped and counted.
 */
export function normalizeRows(
  table: RawTable,
  mapping: Mapping,
  overrides: Record<number, RowOverride> = {},
): { rows: ImportRow[]; droppedTotals: number } {
  const col = (f: ImportField) => mapping.indexOf(f);
  const get = (r: RawRow, f: ImportField) => (col(f) >= 0 ? r.cells[col(f)] : undefined);
  const header = (f: ImportField) => (col(f) >= 0 ? table.headers[col(f)] || FIELD_LABELS[f] : FIELD_LABELS[f]);
  const rows: ImportRow[] = [];
  let droppedTotals = 0;
  // "Sunrise Hotel" and "sunrise hotel" are one sponsor: the first spelling wins.
  const sponsorSpelling = new Map<string, string>();
  const canonicalSponsor = (name: string) => {
    const k = name.toLowerCase();
    if (!sponsorSpelling.has(k)) sponsorSpelling.set(k, name);
    return sponsorSpelling.get(k)!;
  };

  for (const r of table.rows) {
    const issues: Issue[] = [];
    const titleCell = oneLine(text(get(r, "title")));
    const descCell = text(get(r, "description")).trim();
    const sponsorRaw = oneLine(text(get(r, "sponsor")));
    if (!titleCell && !descCell && !sponsorRaw) {
      const anyNumber = r.cells.some((c) => typeof c.v === "number" || c.err);
      if (anyNumber) droppedTotals++;
      continue;
    }

    let title = titleCell || titleFromDescription(descCell);
    let description = multiLine(descCell);
    if (oneLine(description) === title) description = "";
    // Title taken from the first line: don't repeat that line on the card.
    if (!titleCell && description) {
      const [first, ...rest] = description.split("\n");
      if (oneLine(first) === title) description = rest.join("\n").trim();
    }
    if (!titleCell && descCell) {
      issues.push({ level: "info", field: "title", message: "Title taken from the description — edit it if needed." });
    }

    // Quantity: column, "10x" in the organizer column (as in last year's file), or a "10x " title prefix.
    let quantity = 1;
    const qCell = get(r, "quantity");
    if (qCell && !isEmpty(qCell)) {
      const q = parseAmount(qCell);
      const m = QTY_CELL.exec(text(qCell));
      const n = q.value ?? (m ? Number(m[1] ?? m[2]) : null);
      if (n != null && Number.isInteger(n) && n >= 1) quantity = n;
      else issues.push({ level: "warning", field: "quantity", message: `${header("quantity")} “${text(qCell)}” isn't a whole number — using 1.` });
    }
    let organizer = oneLine(text(get(r, "organizer")));
    const orgQty = QTY_CELL.exec(organizer);
    if (orgQty) {
      if (quantity === 1) quantity = Number(orgQty[1] ?? orgQty[2]);
      issues.push({ level: "warning", field: "quantity", message: `“${organizer}” in ${header("organizer")} read as quantity ${quantity}.` });
      organizer = "";
    }
    const prefix = QTY_PREFIX.exec(title);
    if (prefix && quantity === 1) {
      quantity = Number(prefix[1]);
      title = title.slice(prefix[0].length).trim();
    }
    if (quantity > MAX_QUANTITY) {
      issues.push({ level: "error", field: "quantity", message: `Quantity ${quantity} is more than ${MAX_QUANTITY} — split it up or correct it.` });
    } else if (quantity > 1) {
      issues.push({ level: "warning", field: "quantity", message: `Lot of ${quantity}: becomes ${quantity} separate items “${clip(title, 40)} (1/${quantity})” … “(${quantity}/${quantity})”.` });
    }

    // Amounts.
    let fixedPrice = false;
    const amount = (f: ImportField): number | null => {
      const a = parseAmount(get(r, f));
      if (a.fixed) {
        fixedPrice = true;
        return null;
      }
      if (a.issue) issues.push({ level: "warning", field: f, message: `${header(f)} ${a.issue}` });
      return a.value;
    };
    const retailValue = amount("retailValue");
    // "with a Retail Value of >10.000 THB" lines: the value is shown on the card ("Value ฿10,000").
    if (retailValue != null && description) {
      description = description
        .split("\n")
        .filter((l) => !/^\W*(with an? )?(approx\.?\s*|approximate\s+)?(retail\s+)?value\b[^a-z]*(of\s*)?[^a-z]*(thb|baht|eur|usd|€|\$|฿)?[^a-z]*$/i.test(l.trim()))
        .map((l) => l.replace(/\s*[,;–-]?\s*(with an? )?(approx\.?\s*)?retail value\b[^a-z]*(of\s*)?[^a-z]*(thb|baht|eur|usd|€|\$|฿)?[^a-z]*$/i, "").trim())
        .join("\n")
        .trim();
      if (!titleCell) {
        const [first, ...rest] = description.split("\n");
        if (oneLine(first) === title) description = rest.join("\n").trim();
      }
    }
    let startingBid = amount("startingBid");
    let increment = amount("increment");
    let buyNow = amount("buyNow");

    // Type.
    let kind: "voucher" | "physical";
    let kindGuessed = false;
    const kindCell = text(get(r, "kind"));
    const parsedKind = kindCell ? parseKind(kindCell) : null;
    if (parsedKind) kind = parsedKind;
    else {
      kind = guessKind(`${title} ${description} ${sponsorRaw}`);
      kindGuessed = true;
      if (kindCell) issues.push({ level: "warning", field: "kind", message: `Type “${clip(kindCell, 30)}” not recognised — guessed ${kind}.` });
    }

    const notes = [oneLine(text(get(r, "notes"))), organizer ? `Organized by: ${organizer}` : ""].filter(Boolean).join(" · ");
    const lotCell = get(r, "lot");
    const lot = lotCell && !isEmpty(lotCell) ? oneLine(text(lotCell)) : null;

    // Host overrides from the preview.
    const o = overrides[r.rowNumber] ?? {};
    if (o.title !== undefined && o.title.trim()) title = oneLine(o.title).slice(0, 200);
    if (o.kind) {
      kind = o.kind;
      kindGuessed = false;
    }
    if (o.startingBid !== undefined) startingBid = o.startingBid;
    if (o.increment !== undefined) increment = o.increment;
    if (o.buyNow !== undefined) buyNow = o.buyNow;

    if (fixedPrice) {
      issues.push({
        level: "warning",
        message: "Marked as sold at a fixed price / not auctioned. Skipped unless you include it — then it is offered at a fixed price (Buy now only).",
      });
      const price = buyNow ?? retailValue ?? startingBid;
      if (price != null && price > 0) {
        buyNow = price;
        startingBid = price;
      }
    } else if (startingBid == null && retailValue != null && retailValue > 0) {
      startingBid = defaultStartingBid(retailValue);
      issues.push({ level: "warning", field: "startingBid", message: `No starting bid — suggested ${startingBid} (20 % of the value). Check it.` });
    }
    if (startingBid != null && startingBid > 0 && (increment == null || !(increment > 0))) {
      increment = defaultIncrement(startingBid);
      issues.push({ level: "info", field: "increment", message: `Increment set to ${increment} (10 % of the starting bid).` });
    }

    const skip = o.skip ?? fixedPrice;
    if (!title) issues.push({ level: "error", field: "title", message: "No title or description." });
    if (title.length > 200) {
      title = `${title.slice(0, 199)}…`;
      issues.push({ level: "warning", field: "title", message: "Title shortened to 200 characters." });
    }
    if (fixedPrice && !(buyNow != null && buyNow > 0)) {
      if (!skip) issues.push({ level: "error", field: "buyNow", message: "Enter the fixed price to include this lot." });
    } else if (!(startingBid != null && startingBid > 0)) {
      issues.push({ level: "error", field: "startingBid", message: "Starting bid missing — enter one." });
    }
    if (buyNow != null && startingBid != null && buyNow < startingBid) {
      issues.push({ level: "warning", field: "buyNow", message: `Buy now (${buyNow}) is below the starting bid — dropped.` });
      buyNow = null;
    }
    if (retailValue != null && startingBid != null && retailValue > 0 && startingBid > retailValue && !fixedPrice) {
      issues.push({ level: "warning", field: "startingBid", message: "Starting bid is above the retail value." });
    }

    const img = table.images[r.rowNumber];
    rows.push({
      key: r.rowNumber,
      lot,
      title,
      description,
      kind,
      kindGuessed,
      sponsor: sponsorRaw ? canonicalSponsor(sponsorRaw.slice(0, 200)) : null,
      retailValue,
      startingBid,
      increment,
      buyNow: buyNow != null && startingBid != null && buyNow >= startingBid ? buyNow : null,
      quantity,
      notes,
      fixedPrice,
      skip,
      hasPhoto: Boolean(img?.photo),
      hasLogo: Boolean(img?.logo),
      issues,
    });
  }

  // Duplicate-looking logos: a logo used for several different sponsors is an organiser logo.
  const sponsorsByLogo = new Map<string, Set<string>>();
  for (const row of rows) {
    const logo = table.images[row.key]?.logo;
    if (logo && row.sponsor) {
      const s = sponsorsByLogo.get(logo.hash) ?? new Set<string>();
      s.add(row.sponsor.toLowerCase());
      sponsorsByLogo.set(logo.hash, s);
    }
  }
  for (const row of rows) {
    const logo = table.images[row.key]?.logo;
    if (logo && ((sponsorsByLogo.get(logo.hash)?.size ?? 0) > 1 || !row.sponsor)) row.hasLogo = false;
  }
  return { rows, droppedTotals };
}

export const rowBlocked = (r: ImportRow) => !r.skip && r.issues.some((i) => i.level === "error");

/** Importable rows → one draft per unit ("Title (1/10)" … for multi-unit lots). */
export function expandDrafts(rows: ImportRow[]): ItemDraft[] {
  const out: ItemDraft[] = [];
  for (const r of rows) {
    if (r.skip || rowBlocked(r)) continue;
    const startingBid = r.startingBid!;
    const base: ItemDraft = {
      key: r.key,
      title: r.title,
      description: r.description,
      kind: r.kind,
      sponsor: r.sponsor,
      retailValue: r.retailValue,
      startingBid,
      increment: r.increment && r.increment > 0 ? r.increment : defaultIncrement(startingBid),
      buyNow: r.buyNow,
      notes: r.notes,
    };
    if (r.quantity <= 1) out.push(base);
    else for (let i = 1; i <= r.quantity; i++) out.push({ ...base, title: `${r.title} (${i}/${r.quantity})`.slice(0, 200) });
  }
  return out;
}

export function summarize(rows: ImportRow[]) {
  const importable = rows.filter((r) => !r.skip && !rowBlocked(r));
  return {
    rows: rows.length,
    items: importable.reduce((n, r) => n + r.quantity, 0),
    skipped: rows.filter((r) => r.skip).length,
    blocked: rows.filter(rowBlocked).length,
    warnings: rows.reduce((n, r) => n + r.issues.filter((i) => i.level === "warning").length, 0),
    errors: rows.reduce((n, r) => n + r.issues.filter((i) => i.level === "error").length, 0),
    multiUnitLots: rows.filter((r) => !r.skip && r.quantity > 1).length,
    fixedPrice: rows.filter((r) => r.fixedPrice).length,
    photos: importable.filter((r) => r.hasPhoto).length,
  };
}

// ————————————————————————————————————————— template

export const TEMPLATE_COLUMNS: Array<{ header: string; width: number; note: string }> = [
  { header: "No.", width: 6, note: "Lot number (optional)" },
  { header: "Title", width: 36, note: "Short name shown on the card. Empty: taken from the description." },
  { header: "Description", width: 50, note: "Details, dates, conditions" },
  { header: "Type", width: 12, note: "voucher or physical. Empty: guessed (hotel, spa, dinner … = voucher)." },
  { header: "Sponsor", width: 28, note: "Donated by. Existing sponsors are reused by name." },
  { header: "Retail value", width: 13, note: "Shown to guests as “Value ฿X”" },
  { header: "Starting bid", width: 13, note: "Empty: 20 % of the retail value" },
  { header: "Increment", width: 11, note: "Empty: 10 % of the starting bid" },
  { header: "Buy now", width: 11, note: "Optional fixed price that ends bidding" },
  { header: "Quantity", width: 9, note: "e.g. 10 → 10 separate items “(1/10)” …" },
  { header: "Notes", width: 30, note: "Host-only (not shown to guests)" },
];

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FlüsterLos";
  const ws = wb.addWorksheet("Prizes", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5F2" } };
  TEMPLATE_COLUMNS.forEach((c, i) => {
    ws.getCell(1, i + 1).note = c.note;
  });
  const help = wb.addWorksheet("How to");
  help.columns = [{ header: "Column", width: 16 }, { header: "What to enter", width: 80 }];
  help.getRow(1).font = { bold: true };
  for (const c of TEMPLATE_COLUMNS) help.addRow([c.header, c.note]);
  help.addRow([]);
  help.addRow(["Tip", "One row per lot. Fill the “Prizes” sheet and upload it under Event → Import items. Photos and voucher PDFs can be added afterwards in bulk (file names like “03-spa.jpg” or “Spa Day.pdf”)."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
