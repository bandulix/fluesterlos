import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  autoMapping,
  buildTemplate,
  defaultIncrement,
  defaultStartingBid,
  expandDrafts,
  guessKind,
  matchHeader,
  normalizeRows,
  parseAmount,
  parseImportFile,
  pickSheet,
  summarize,
  titleFromDescription,
  type RawTable,
} from "../src/itemImport.js";
import { buildImportWorkbook, buildLargeWorkbook } from "./fixtures/importWorkbook.js";
import { bid, createOpenEvent, freshApp, hostCookie, joinGuest, multipart, ph, pool } from "./helpers.js";

const csvTable = (text: string) => parseImportFile("items.csv", Buffer.from(text, "utf8"));

describe("item import: parsing last year's layout (synthetic fixture)", () => {
  it("picks the Prizes sheet, finds the header in row 3, ignores the paper bid sheets", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    expect(t.sheetName).toBe("Prizes");
    expect(t.headerRow).toBe(3);
    expect(t.skippedSheets).toEqual(["Liste 2", "Liste 1", "Rules of the Auction"]);
    expect(autoMapping(t.headers)).toEqual([
      "lot", "organizer", "sponsor", "description", "retailValue", "startingBid",
      "ignore", "ignore", "ignore", "ignore", "ignore", "notes",
    ]);
  });

  it("normalizes rows: defaults, text numbers, #VALUE!, fixed price, quantity in “Organized by”, totals row", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    const { rows, droppedTotals } = normalizeRows(t, autoMapping(t.headers));
    expect(droppedTotals).toBe(1);
    expect(rows).toHaveLength(7);
    const [hotel, choc, spa, candy, brunch, watch, golf] = rows;

    expect(hotel.title).toBe("1 Night for Two in a Deluxe Room including Breakfast");
    // Line breaks kept; the "retail value …" line is dropped (the card shows "Value ฿6,000"), and the
    // title isn't repeated at the start of the description (round 4) — the dates stay.
    expect(hotel.description).toBe("(01MAR - 31JUL 2099)\nValid Sunday–Thursday");
    expect(hotel).toMatchObject({ kind: "voucher", sponsor: "Sunrise Hotel", retailValue: 6000, startingBid: 1000, increment: 100 });
    expect(hotel.notes).toBe("Organized by: Alex");
    // The buyer / payment columns never leak into notes or descriptions.
    expect(JSON.stringify(rows)).not.toMatch(/Buyer \d|Cash/);

    expect(choc).toMatchObject({ sponsor: "Choco Factory", retailValue: 4500, startingBid: 900, increment: 90, kind: "physical" });
    expect(spa.retailValue).toBeNull();
    expect(spa.issues.some((i) => i.level === "warning" && /#VALUE!/.test(i.message))).toBe(true);
    expect(candy).toMatchObject({ fixedPrice: true, skip: true });
    expect(brunch).toMatchObject({ quantity: 10, notes: "" });
    expect(brunch.issues.map((i) => i.message).join(" ")).toMatch(/quantity 10.*Lot of 10/);
    expect(watch).toMatchObject({ startingBid: 900, increment: 90, notes: "Pick up at the front desk", kind: "physical" });
    expect(watch.issues.some((i) => /suggested 900/.test(i.message))).toBe(true);
    // Same sponsor in another spelling → one sponsor.
    expect(golf.sponsor).toBe("Sunrise Hotel");

    expect(summarize(rows)).toMatchObject({ rows: 7, items: 15, skipped: 1, errors: 0, multiUnitLots: 1, fixedPrice: 1, photos: 2 });
  });

  it("extracts the prize photo and the sponsor logo from the bid sheets that reference a Prizes row", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    expect(Object.keys(t.images).sort()).toEqual(["4", "5"]);
    for (const k of [4, 5]) {
      expect(t.images[k].photo!.buffer.length).toBeGreaterThan(t.images[k].logo!.buffer.length);
      expect(t.images[k].photo!.name).toMatch(/^[0-9a-f]{12}\.png$/);
    }
  });

  it("expands multi-unit lots into numbered items", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    const drafts = expandDrafts(normalizeRows(t, autoMapping(t.headers)).rows);
    expect(drafts).toHaveLength(15);
    const brunch = drafts.filter((d) => d.title.startsWith("Exclusive Sunday Brunch"));
    expect(brunch.map((d) => d.title)).toEqual(Array.from({ length: 10 }, (_, i) => `Exclusive Sunday Brunch for One (${i + 1}/10)`));
    expect(new Set(brunch.map((d) => d.startingBid))).toEqual(new Set([400]));
    expect(drafts.some((d) => d.title.startsWith("Candy"))).toBe(false);
  });

  it("fixed-price lot: included → buy-now only at the price; without a price it is blocked", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    const m = autoMapping(t.headers);
    const blocked = normalizeRows(t, m, { 7: { skip: false } }).rows[3];
    expect(blocked.issues.some((i) => i.level === "error")).toBe(true);
    expect(expandDrafts([blocked])).toHaveLength(0);
    const ok = normalizeRows(t, m, { 7: { skip: false, buyNow: 350 } }).rows[3];
    expect(ok).toMatchObject({ skip: false, startingBid: 350, buyNow: 350 });
    expect(ok.issues.some((i) => i.level === "error")).toBe(false);
  });

  it("row overrides: skip, type, title, prices", async () => {
    const t = await parseImportFile("auction.xlsx", await buildImportWorkbook());
    const { rows } = normalizeRows(t, autoMapping(t.headers), {
      4: { skip: true },
      5: { kind: "voucher", title: "Chocolate box", startingBid: 1000 },
    });
    expect(rows[0].skip).toBe(true);
    expect(rows[1]).toMatchObject({ kind: "voucher", kindGuessed: false, title: "Chocolate box", startingBid: 1000, increment: 100 });
  });
});

describe("item import: mapping and helpers", () => {
  it("matches English and German header variants", () => {
    const cases: Record<string, string | null> = {
      "Nr.": "lot", "Lot #": "lot", Titel: "title", "Item name": "title", Beschreibung: "description",
      Spender: "sponsor", "Donated by": "sponsor", Wert: "retailValue", "Retail value (THB)": "retailValue",
      Mindestgebot: "startingBid", "Start price": "startingBid", Schrittweite: "increment", "Minimum Steps": "increment",
      Sofortkauf: "buyNow", "Buy now": "buyNow", Anzahl: "quantity", Qty: "quantity", Bemerkung: "notes",
      Typ: "kind", Type: "kind", "Bought by": "ignore", "Final Price achieved": "ignore", Zuschlag: "ignore",
      "Favourite colour": null,
    };
    for (const [h, f] of Object.entries(cases)) expect([h, matchHeader(h)]).toEqual([h, f]);
  });

  it("each field is auto-mapped to at most one column; unknown columns stay unmapped", () => {
    expect(autoMapping(["Title", "Name", "Description", "Foo"])).toEqual(["title", null, "description", null]);
  });

  it("sheet choice: Prizes, else the first non-bid sheet", () => {
    expect(pickSheet(["Liste 2", "Liste 1", "Prizes"])).toBe("Prizes");
    expect(pickSheet(["Liste 1", "Sheet1 copy", "Other"])).toBe("Sheet1 copy");
    // Only bid sheets: fall back to the first sheet rather than refusing.
    expect(pickSheet(["Liste 1", "Liste 2"])).toBe("Liste 1");
  });

  it("amounts: thousands separators, currency, text numbers, errors, fixed price", () => {
    expect(parseAmount({ v: "14.000" }).value).toBe(14000);
    expect(parseAmount({ v: "THB 1,250" }).value).toBe(1250);
    expect(parseAmount({ v: "฿ 2 500" }).value).toBe(2500);
    expect(parseAmount({ v: "15.00" }).value).toBe(15);
    expect(parseAmount({ v: "1.234,50 €" }).value).toBe(1234.5);
    expect(parseAmount({ v: 900 }).value).toBe(900);
    expect(parseAmount({ v: null, err: "#VALUE!" })).toMatchObject({ value: null });
    expect(parseAmount({ v: null, err: "#VALUE!" }).issue).toMatch(/#VALUE!/);
    expect(parseAmount({ v: "sold not auctioned" }).fixed).toBe(true);
    expect(parseAmount({ v: "Festpreis" }).fixed).toBe(true);
    expect(parseAmount({ v: "ask Anna" }).issue).toBeTruthy();
  });

  it("defaults: increment = starting bid / 10 like last year's “E11/10”; starting bid ≈ 20 % of value", () => {
    expect(defaultIncrement(1000)).toBe(100);
    expect(defaultIncrement(250)).toBe(25);
    expect(defaultIncrement(1234)).toBe(120);
    expect(defaultIncrement(5)).toBe(1);
    expect(defaultStartingBid(4500)).toBe(900);
    expect(defaultStartingBid(1250)).toBe(250);
  });

  it("type guess: vouchers and stays vs physical things", () => {
    for (const s of ["2 Nights for Two", "Sunday Brunch", "Gutschein Restaurant", "Spa day", "Hotel stay", "Dinner for 2"]) {
      expect([s, guessKind(s)]).toEqual([s, "voucher"]);
    }
    for (const s of ["Original Swiss Watch", "Signed jersey", "Water filter", "Necklace and earrings"]) {
      expect([s, guessKind(s)]).toEqual([s, "physical"]);
    }
  });

  it("title from a long multi-line description", () => {
    expect(titleFromDescription("3 Nights for Two (16MAR - 31OCT 2099)\nmore")).toBe("3 Nights for Two");
    expect(titleFromDescription("Spa Day\nretail value THB 2.000")).toBe("Spa Day");
    const long = titleFromDescription("A ".repeat(80) + "end");
    expect(long.length).toBeLessThanOrEqual(81);
    expect(long.endsWith("…")).toBe(true);
  });

  it("CSV: semicolons, German headers, quantity column and “3x” title prefix", async () => {
    const t = await csvTable(
      "\uFEFFNr.;Titel;Beschreibung;Typ;Spender;Wert;Mindestgebot;Schrittweite;Sofortkauf;Anzahl;Bemerkung\n" +
        '1;Brunch;"Sonntagsbrunch\nfür zwei";Gutschein;Hotel Sonne;"2.500";500;;;4;\n' +
        "2;3x Kinogutschein;;;Kino;300;100;20;250;;\n" +
        "3;Uhr;;Sachpreis;;#VALUE!;1000;;900;;abholen\n",
    );
    expect(t.sheetName).toBe("CSV");
    const { rows } = normalizeRows(t, autoMapping(t.headers));
    expect(rows[0]).toMatchObject({ title: "Brunch", description: "Sonntagsbrunch\nfür zwei", kind: "voucher", kindGuessed: false, retailValue: 2500, startingBid: 500, increment: 50, quantity: 4 });
    expect(rows[1]).toMatchObject({ title: "Kinogutschein", quantity: 3, increment: 20, buyNow: 250 });
    expect(rows[2]).toMatchObject({ kind: "physical", retailValue: null, buyNow: null, notes: "abholen" });
    expect(rows[2].issues.some((i) => /Buy now/i.test(i.message))).toBe(true);
    expect(expandDrafts(rows)).toHaveLength(8);
  });

  it("missing title and starting bid are errors (row is not imported)", async () => {
    const t = await csvTable("Title,Description,Starting bid\n,,100\nLamp,,\n");
    const { rows } = normalizeRows(t, autoMapping(t.headers));
    expect(rows).toHaveLength(1);
    expect(rows[0].issues.some((i) => i.level === "error" && i.field === "startingBid")).toBe(true);
    expect(expandDrafts(rows)).toHaveLength(0);
  });

  it("rejects files without a usable header and old .xls", async () => {
    await expect(csvTable("a,b\n1,2\n")).rejects.toThrow(/header row/);
    await expect(parseImportFile("old.xls", Buffer.from("x"))).rejects.toThrow(/\.xlsx/);
  });

  it("the blank template round-trips: every column auto-maps, no rows", async () => {
    const buf = await buildTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Prizes", "How to"]);
    const t = await parseImportFile("template.xlsx", buf);
    expect(autoMapping(t.headers)).toEqual([
      "lot", "title", "description", "kind", "sponsor", "retailValue", "startingBid", "increment", "buyNow", "quantity", "notes",
    ]);
    expect(normalizeRows(t, autoMapping(t.headers)).rows).toHaveLength(0);
  });
});

// Optional local check against a real workbook. The file is never committed:
//   FL_IMPORT_REAL_FILE=/path/to/last-year.xlsx npx vitest run test/itemImport.test.ts
const REAL = process.env.FL_IMPORT_REAL_FILE;
describe.skipIf(!REAL || !existsSync(REAL))("item import: real workbook (local only)", () => {
  it("parses into a sensible preview (aggregate checks only)", async () => {
    const t: RawTable = await parseImportFile("real.xlsx", readFileSync(REAL!));
    const { rows } = normalizeRows(t, autoMapping(t.headers));
    const s = summarize(rows);
    expect(t.sheetName).toBe("Prizes");
    expect(s.rows).toBeGreaterThan(0);
    expect(s.errors).toBe(0);
    console.log("real workbook:", JSON.stringify({ sheet: t.sheetName, headerRow: t.headerRow, skippedSheets: t.skippedSheets.length, ...s }));
  });
});

describe("item import: API", () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    app = await freshApp();
    cookie = await hostCookie(app);
  });
  afterAll(async () => app?.close());

  async function upload(code: string, buf: Buffer, filename = "auction.xlsx") {
    const mp = multipart({}, [{ field: "file", filename, type: "application/octet-stream", content: buf }]);
    return app.inject({
      method: "POST",
      url: `/api/host/events/${code}/import`,
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.payload,
    });
  }

  it("large synthetic event: 48 lots, 27 sponsors, fixed-price lots included by typing their price", async () => {
    const ev = await createOpenEvent(app, cookie, []);
    const res = await upload(ev.code, await buildLargeWorkbook());
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.summary).toMatchObject({ rows: 48, items: 46, skipped: 2, fixedPrice: 2 });
    const fixedKeys = p.rows.filter((r: { fixedPrice: boolean }) => r.fixedPrice).map((r: { key: number }) => r.key);
    const overrides = Object.fromEntries(fixedKeys.map((k: number) => [k, { skip: false, buyNow: 3000 }]));
    const pv = await app.inject({ method: "POST", url: `/api/host/events/${ev.code}/import/${p.sessionId}/preview`, headers: { cookie }, payload: { mapping: p.mapping, overrides } });
    expect(pv.json().summary).toMatchObject({ items: 48, errors: 0 });
    // The description no longer repeats the title.
    expect(pv.json().rows[0].description).toBe("valid until 31 Dec 2099\nSynthetic test lot");
    const commit = await app.inject({ method: "POST", url: `/api/host/events/${ev.code}/import/${p.sessionId}/commit`, headers: { cookie }, payload: { mapping: p.mapping, overrides } });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().created).toBe(48);
    const items = commit.json().live.items as Array<{ title: string; buyNow: number | null; startingBid: number; sponsor: { id: string } | null }>;
    const fixed = items.filter((i) => i.buyNow != null && i.buyNow === i.startingBid);
    expect(fixed).toHaveLength(2);
    expect(new Set(items.filter((i) => i.sponsor).map((i) => i.sponsor!.id)).size).toBe(27);
  });

  it("preview → commit: creates expanded items, reuses sponsors, stores retail value, notes stay host-only", async () => {
    const { code } = await createOpenEvent(app, cookie, [{ title: "Existing lot", startingBid: 100, minIncrement: 10 }]);
    await pool.query("INSERT INTO sponsors (name) VALUES ('SUNRISE HOTEL')");
    const res = await upload(code, await buildImportWorkbook());
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({ sheetName: "Prizes", headerRow: 3, existingItems: 1, locked: null });
    expect(p.summary).toMatchObject({ rows: 7, items: 15, skipped: 1 });
    expect(p.rows[0]).toMatchObject({ sponsor: "Sunrise Hotel", sponsorIsNew: false });
    expect(p.rows[1]).toMatchObject({ sponsor: "Choco Factory", sponsorIsNew: true });
    expect(p.rows[0].photoUrl).toMatch(/^\/api\/host\/import\/[0-9a-f-]{36}\/images\/[0-9a-f]{12}\.png$/);
    const img = await app.inject({ method: "GET", url: p.rows[0].photoUrl, headers: { cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toMatch(/image\/png/);
    expect((await app.inject({ method: "GET", url: p.rows[0].photoUrl })).statusCode).toBe(401);
    // Column samples show the host what is in each column.
    expect(p.columns[3]).toMatchObject({ header: "Description", field: "description" });

    const commit = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/import/${p.sessionId}/commit`,
      headers: { cookie },
      payload: { mapping: p.mapping, overrides: { 9: { kind: "voucher" } } },
    });
    expect(commit.statusCode).toBe(200);
    const out = commit.json();
    expect(out.created).toBe(15);
    expect(out.items[0]).toMatchObject({ lot: 2, title: "1 Night for Two in a Deluxe Room including Breakfast" });
    const live = out.live as { items: Array<Record<string, unknown>> };
    expect(live.items).toHaveLength(16);
    const hotel = live.items[1];
    expect(hotel).toMatchObject({ retailValue: 6000, startingBid: 1000, minIncrement: 100, kind: "voucher" });
    expect(hotel.photoUrl).toBeTruthy();
    expect(live.items.find((i) => i.title === "Original Swiss Watch")).toMatchObject({ kind: "voucher", retailValue: 4500 });
    expect(live.items.filter((i) => String(i.title).startsWith("Exclusive Sunday Brunch for One ("))).toHaveLength(10);
    expect(JSON.stringify(live)).not.toMatch(/Organized by|front desk/);
    const sponsors = (await pool.query("SELECT name, logo_path FROM sponsors ORDER BY name")).rows;
    expect(sponsors.map((s) => s.name)).toEqual(["Brunch Club", "Choco Factory", "Garden Spa", "SUNRISE HOTEL", "Watch Co"]);
    // Logo from the bid sheet filled the missing logo of the existing sponsor.
    expect(sponsors.find((s) => s.name === "SUNRISE HOTEL")!.logo_path).toBeTruthy();
    const notes = (await pool.query("SELECT notes FROM items WHERE title LIKE '1 Night%'")).rows[0].notes;
    expect(notes).toBe("Organized by: Alex");
    const hostNotes = await app.inject({ method: "GET", url: `/api/host/events/${code}/item-notes`, headers: { cookie } });
    expect(Object.values(hostNotes.json().notes)).toContain("Organized by: Alex");
    expect((await app.inject({ method: "GET", url: `/api/host/events/${code}/item-notes` })).statusCode).toBe(401);
    // The session is gone after the import.
    const again = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/import/${p.sessionId}/commit`,
      headers: { cookie },
      payload: {},
    });
    expect(again.statusCode).toBe(404);
  });

  it("re-mapping a column via the preview endpoint", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    const p = (await upload(code, Buffer.from("Name,Text,Min\nLamp,Nice lamp,500\n"), "items.csv")).json();
    expect(p.mapping).toEqual(["title", "description", null]);
    expect(p.rows[0].issues.some((i: { field?: string; level: string }) => i.level === "error" && i.field === "startingBid")).toBe(true);
    const re = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/import/${p.sessionId}/preview`,
      headers: { cookie },
      payload: { mapping: ["title", "description", "startingBid"] },
    });
    expect(re.statusCode).toBe(200);
    expect(re.json().rows[0]).toMatchObject({ startingBid: 500, increment: 50 });
    expect(re.json().summary).toMatchObject({ items: 1, errors: 0 });
  });

  it("refuses to import once the auction has bids", async () => {
    const { code, items } = await createOpenEvent(app, cookie, [{ title: "Lot", startingBid: 100, minIncrement: 10 }]);
    const p = (await upload(code, await buildImportWorkbook())).json();
    const g = await joinGuest(app, code, ph(1), "Anna");
    expect((await bid(app, code, g.token, items[0].id, 100)).statusCode).toBe(200);
    const commit = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/import/${p.sessionId}/commit`,
      headers: { cookie },
      payload: {},
    });
    expect(commit.statusCode).toBe(409);
    expect(commit.json().error).toMatch(/bids/);
    expect((await upload(code, await buildImportWorkbook())).json().locked).toMatch(/bids/);
    expect((await pool.query("SELECT COUNT(*)::int AS c FROM items")).rows[0].c).toBe(1);
  });

  it("host-only, and a session belongs to its event", async () => {
    const a = await createOpenEvent(app, cookie, []);
    const b = await createOpenEvent(app, cookie, []);
    const mp = multipart({}, [{ field: "file", filename: "x.csv", type: "text/csv", content: "Title,Starting bid\nA,10\n" }]);
    const anon = await app.inject({ method: "POST", url: `/api/host/events/${a.code}/import`, headers: { "content-type": mp.contentType }, payload: mp.payload });
    expect(anon.statusCode).toBe(401);
    const p = (await upload(a.code, Buffer.from("Title,Starting bid\nA,10\n"), "x.csv")).json();
    const wrong = await app.inject({ method: "POST", url: `/api/host/events/${b.code}/import/${p.sessionId}/commit`, headers: { cookie }, payload: {} });
    expect(wrong.statusCode).toBe(404);
    const bad = await upload(a.code, Buffer.from("just text"), "notes.pdf");
    expect(bad.statusCode).toBe(400);
  });

  it("template download", async () => {
    const res = await app.inject({ method: "GET", url: "/api/host/import/template.xlsx", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/fluesterlos-items-template\.xlsx/);
    expect((await app.inject({ method: "GET", url: "/api/host/import/template.xlsx" })).statusCode).toBe(401);
  });

  it("items: retail value + notes via add/edit; buy-now may equal the starting bid (fixed price)", async () => {
    const { code } = await createOpenEvent(app, cookie, []);
    const mp = multipart({ title: "Candy set", startingBid: "350", minIncrement: "35", buyNow: "350", retailValue: "500", notes: "from Dana" });
    const add = await app.inject({ method: "POST", url: `/api/host/events/${code}/items`, headers: { cookie, "content-type": mp.contentType }, payload: mp.payload });
    expect(add.statusCode).toBe(200);
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    expect(live.items[0]).toMatchObject({ buyNow: 350, startingBid: 350, retailValue: 500 });
    expect(JSON.stringify(live)).not.toMatch(/from Dana/);
    const id = live.items[0].id;
    const patch = await app.inject({ method: "PATCH", url: `/api/host/events/${code}/items/${id}`, headers: { cookie }, payload: { retailValue: "", notes: "n2" } });
    expect(patch.statusCode).toBe(200);
    expect((await pool.query("SELECT retail_value, notes FROM items WHERE id = $1", [id])).rows[0]).toEqual({ retail_value: null, notes: "n2" });
    const low = multipart({ title: "X", startingBid: "350", minIncrement: "35", buyNow: "300" });
    expect((await app.inject({ method: "POST", url: `/api/host/events/${code}/items`, headers: { cookie, "content-type": low.contentType }, payload: low.payload })).statusCode).toBe(400);
  });
});
