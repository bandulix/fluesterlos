/**
 * Synthetic workbook with the same layout as a real charity-auction "Prizes" workbook
 * (no real names or data): bid sheets "Liste N" first, a "Prizes" sheet with the header in
 * row 3, multi-line descriptions, a richText sponsor, a quantity misplaced in "Organized by",
 * a "sold not auctioned" lot, a #VALUE! cell, numbers stored as text, a SUM totals row, and
 * paper bid sheets that reference Prizes!C/D/F and carry a logo + a prize photo.
 */
import ExcelJS from "exceljs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Solid-colour RGB PNG (with a little noise so sizes differ). */
export function solidPng(w: number, h: number, rgb: [number, number, number], noise = 0): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = noise ? (seed % (noise * 2)) - noise : 0;
      for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.max(0, Math.min(255, rgb[c] + n));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const HEADERS = [
  "No.",
  "Organized by",
  "Sponsor Name",
  "Description",
  "Approximate Value",
  "Suggested Minimum",
  "Final Price achieved",
  "Bought by",
  "Money\nreceived?",
  "Payment Method",
  "Handed over?",
  "Remark",
];

type Lot = [no: number, organizer: string, sponsor: ExcelJS.CellValue, desc: string, value: ExcelJS.CellValue, min: ExcelJS.CellValue, remark?: string];

export const LOTS: Lot[] = [
  [1, "Alex", "Sunrise Hotel", "1 Night for Two in a Deluxe Room including Breakfast (01MAR - 31JUL 2099)\nValid Sunday–Thursday\nretail value THB 6.000", 6000, 1000],
  [2, "Bea", { richText: [{ text: "Choco " }, { font: { bold: true }, text: "Factory" }] }, "Large Gift Box of Premium Chocolate", "4,500", "900"],
  [3, "Chris", "Garden Spa", "Spa Day for Two", { error: "#VALUE!" } as unknown as ExcelJS.CellValue, 1500],
  [4, "Dana", "Snack Corner", "Candy Set \"Sweet galore\"", "sold not auctioned", null],
  [5, "10x", "Brunch Club", "Exclusive Sunday Brunch for One", 2300, 400],
  [6, "", "Watch Co", "Original Swiss Watch", 4500, null, "Pick up at the front desk"],
  [7, "Eve", "sunrise hotel", "Voucher for one Golf Bay", 1250, 500],
];

export async function buildImportWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const lists = [2, 1].map((n) => wb.addWorksheet(`Liste ${n}`));
  const prizes = wb.addWorksheet("Prizes");
  wb.addWorksheet("Rules of the Auction").getCell("A1").value = "1. Bids in steps of 10 %";

  prizes.getCell("A1").value = "Charity Auction 2099 – Prizes";
  prizes.getRow(3).values = HEADERS;
  LOTS.forEach(([no, org, sponsor, desc, value, min, remark], i) => {
    const r = prizes.getRow(4 + i);
    r.getCell(1).value = no;
    r.getCell(2).value = org;
    r.getCell(3).value = sponsor;
    r.getCell(4).value = desc;
    r.getCell(5).value = value;
    r.getCell(6).value = min;
    // Results columns of last year (must be ignored): a formula price, a buyer, payment flags.
    r.getCell(7).value = { formula: `F${4 + i}*2`, result: 2000 } as ExcelJS.CellFormulaValue;
    r.getCell(8).value = `Buyer ${no}`;
    r.getCell(9).value = "yes";
    r.getCell(10).value = "Cash";
    r.getCell(11).value = "yes";
    if (remark) r.getCell(12).value = remark;
  });
  const last = 3 + LOTS.length;
  prizes.getCell(`E${last + 2}`).value = { formula: `SUM(E4:E${last})`, result: 14050 } as ExcelJS.CellFormulaValue;
  prizes.getCell(`G${last + 2}`).value = { formula: `SUM(G4:G${last})`, result: 14000 } as ExcelJS.CellFormulaValue;

  // Paper bid sheets: Liste 1 → lot 1 (Prizes row 4), Liste 2 → lot 2 (row 5).
  const logo = wb.addImage({ buffer: solidPng(8, 8, [200, 30, 30]) as unknown as ExcelJS.Buffer, extension: "png" });
  const photos = [
    wb.addImage({ buffer: solidPng(48, 32, [30, 120, 200], 40) as unknown as ExcelJS.Buffer, extension: "png" }),
    wb.addImage({ buffer: solidPng(40, 40, [40, 160, 80], 40) as unknown as ExcelJS.Buffer, extension: "png" }),
  ];
  lists.forEach((ws, i) => {
    const n = Number(ws.name.split(" ")[1]);
    const row = 3 + n;
    ws.getCell("A1").value = { formula: `Prizes!D${row}`, result: "…" } as ExcelJS.CellFormulaValue;
    ws.getCell("C3").value = "Logo";
    ws.getCell("E5").value = "Pictures";
    ws.getCell("C7").value = { formula: `Prizes!C${row}`, result: "…" } as ExcelJS.CellFormulaValue;
    ws.getCell("E11").value = { formula: `Prizes!F${row}`, result: 1000 } as ExcelJS.CellFormulaValue;
    ws.getCell("F11").value = { formula: "E11/10", result: 100 } as ExcelJS.CellFormulaValue;
    ws.addImage(n === 1 ? logo : wb.addImage({ buffer: solidPng(8, 8, [10, 10, 10 + i]) as unknown as ExcelJS.Buffer, extension: "png" }), {
      tl: { col: 1.2, row: 2.1 },
      ext: { width: 60, height: 40 },
    });
    ws.addImage(photos[n - 1], { tl: { col: 4.1, row: 5.2 }, ext: { width: 200, height: 150 } });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
