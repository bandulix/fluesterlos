import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import {
  bid,
  closeEvent,
  createOpenEvent,
  e164,
  freshApp,
  hostCookie,
  joinGuest,
  mailbox,
  multipart,
  ph,
  PNG_1PX,
  pool,
} from "./helpers.js";

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

async function emptyEvent() {
  return createOpenEvent(app, cookie, []);
}

function addItem(code: string, fields: Record<string, string>, files: Parameters<typeof multipart>[1] = []) {
  const mp = multipart({ startingBid: "1000", minIncrement: "100", ...fields }, files);
  return app.inject({
    method: "POST",
    url: `/api/host/events/${code}/items`,
    headers: { cookie, "content-type": mp.contentType },
    payload: mp.payload,
  });
}

const PDF = { field: "voucherPdf", filename: "v.pdf", type: "application/pdf", content: "%PDF-1.4 test" };
const LOGO = { field: "sponsorLogo", filename: "logo.png", type: "image/png", content: PNG_1PX };

describe("items: physical prizes and sponsors", () => {
  it("voucher PDF is optional; physical items cannot carry one", async () => {
    const { code } = await emptyEvent();
    expect((await addItem(code, { title: "Hotel night" })).statusCode).toBe(200);
    expect((await addItem(code, { title: "Watch", kind: "physical" })).statusCode).toBe(200);
    expect((await addItem(code, { title: "Jersey", kind: "physical" }, [PDF])).statusCode).toBe(400);
    expect((await addItem(code, { title: "Bad", kind: "raffle" })).statusCode).toBe(400);
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    expect(live.items.map((i: { kind: string; hasVoucher: boolean }) => [i.kind, i.hasVoucher])).toEqual([
      ["voucher", false],
      ["physical", false],
    ]);
  });

  it("sponsor name + logo on an item, reused by name across items, shown in the live payload", async () => {
    const { code } = await emptyEvent();
    const photo = { field: "photo", filename: "p.png", type: "image/png", content: PNG_1PX };
    expect((await addItem(code, { title: "Brunch", sponsorName: "Grand Hotel" }, [PDF, photo, LOGO])).statusCode).toBe(200);
    expect((await addItem(code, { title: "Spa", sponsorName: "grand hotel" })).statusCode).toBe(200);
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    const [a, b] = live.items;
    expect(a.sponsor).toMatchObject({ name: "Grand Hotel", logoUrl: expect.stringMatching(/^\/api\/sponsors\/.+\/logo\?v=.+$/) });
    expect(b.sponsor.id).toBe(a.sponsor.id);
    expect(a.photoUrl).toBeTruthy(); // logo was not mistaken for the photo
    const logo = await app.inject({ method: "GET", url: a.sponsor.logoUrl });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers["content-type"]).toBe("image/png");
    const list = (await app.inject({ method: "GET", url: "/api/host/sponsors", headers: { cookie } })).json();
    expect(list.sponsors).toEqual([expect.objectContaining({ name: "Grand Hotel", itemCount: 2 })]);
  });

  it("sponsors can be created up front (multipart) and picked by id", async () => {
    const { code } = await emptyEvent();
    const mp = multipart({ name: "Swiss Watches" }, [{ ...LOGO, field: "logo" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/host/sponsors",
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    const sponsor = res.json().sponsor;
    expect(sponsor.logoUrl).toBeTruthy();
    expect((await addItem(code, { title: "Watch", kind: "physical", sponsorId: sponsor.id })).statusCode).toBe(200);
    expect((await addItem(code, { title: "X", sponsorId: "00000000-0000-0000-0000-000000000000" })).statusCode).toBe(400);
    const unauth = await app.inject({ method: "GET", url: "/api/host/sponsors" });
    expect(unauth.statusCode).toBe(401);
  });

  it("rejects a non-image sponsor logo", async () => {
    const { code } = await emptyEvent();
    const res = await addItem(code, { title: "X", sponsorName: "S" }, [
      { field: "sponsorLogo", filename: "logo.exe", type: "application/octet-stream", content: "MZ" },
    ]);
    expect(res.statusCode).toBe(400);
  });
});

/** Event with a voucher (with PDF), a voucher without PDF and a physical prize; returns closed state. */
async function wonEvent(opts: { email?: string; voucherPdf?: boolean } = {}) {
  const { code, eventId } = await emptyEvent();
  await addItem(code, { title: "Hotel night", sponsorName: "Grand Hotel" }, opts.voucherPdf === false ? [] : [PDF]);
  await addItem(code, { title: "Signed jersey", kind: "physical", sponsorName: "Football Club" });
  const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
  const g = await joinGuest(app, code, ph(1), "Anna", opts.email);
  for (const it of live.items) expect((await bid(app, code, g.token, it.id, 1000)).statusCode).toBe(200);
  await closeEvent(eventId);
  const inv = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
  return { code, eventId, guest: g, invoice: inv.invoices[0], items: live.items as Array<{ id: string; title: string }> };
}

function confirm(invoiceId: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/host/invoices/${invoiceId}/confirm-payment`,
    headers: { cookie },
    payload: body,
  });
}

describe("payment desk", () => {
  it("cash needs no payslip; method and host are recorded; mixed wins → one email (PDF + collect at desk)", async () => {
    const { invoice } = await wonEvent({ email: "anna@example.org" });
    expect(invoice).toMatchObject({ guestPhone: e164(1), total: 2000, status: "unpaid" });
    const res = await confirm(invoice.id, { method: "cash" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ alreadyPaid: false, emailStatus: "sent", emailed: 1 });
    const mail = mailbox.sent[0];
    expect(mail.to).toBe("anna@example.org");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.text).toMatch(/Hotel night \(by Grand Hotel\).*voucher PDF attached/);
    expect(mail.text).toMatch(/Signed jersey \(by Football Club\).*collect it at the desk/);
    const { rows } = await pool.query("SELECT status, payment_method, paid_by FROM invoices WHERE id = $1", [invoice.id]);
    expect(rows[0]).toEqual({ status: "paid", payment_method: "cash", paid_by: "host@example.org" });
  });

  it("bank transfer / PromptPay without payslip needs explicit host confirmation", async () => {
    const { invoice } = await wonEvent({ email: "anna@example.org" });
    expect((await confirm(invoice.id, { method: "bank_transfer" })).statusCode).toBe(409);
    expect((await confirm(invoice.id, { method: "promptpay" })).statusCode).toBe(409);
    const ok = await confirm(invoice.id, { method: "bank_transfer", confirmedWithoutSlip: true });
    expect(ok.statusCode).toBe(200);
    expect((await confirm(invoice.id, { method: "cash" })).json().alreadyPaid).toBe(true);
  });

  it("no guest email: paid, but email status says so; guest is asked for an email on the invoice page", async () => {
    const { code, guest, invoice } = await wonEvent();
    const gi = (await app.inject({ method: "GET", url: `/api/events/${code}/invoice`, headers: { "x-guest-token": guest.token } })).json();
    expect(gi.guest).toEqual({ email: null, needsEmail: true, hasPhysical: true });
    expect(gi.invoice.lines.map((l: { kind: string; sponsor: { name: string } }) => [l.kind, l.sponsor.name])).toEqual([
      ["voucher", "Grand Hotel"],
      ["physical", "Football Club"],
    ]);
    const res = await confirm(invoice.id, { method: "cash" });
    expect(res.json()).toMatchObject({ emailStatus: "no_email" });
    expect(mailbox.sent).toHaveLength(0);
    // Guest adds email; host resends.
    await app.inject({
      method: "PUT",
      url: `/api/events/${code}/me/email`,
      headers: { "x-guest-token": guest.token },
      payload: { email: "anna@example.org" },
    });
    const send = await app.inject({ method: "POST", url: `/api/host/invoices/${invoice.id}/send-email`, headers: { cookie } });
    expect(send.json()).toMatchObject({ emailStatus: "sent", emailed: 1 });
  });

  it("missing voucher PDF holds the email until it is uploaded", async () => {
    const { code, invoice, items } = await wonEvent({ email: "anna@example.org", voucherPdf: false });
    const res = await confirm(invoice.id, { method: "cash" });
    expect(res.json()).toMatchObject({ emailStatus: "voucher_pdf_missing", missingVoucherPdfs: ["Hotel night"] });
    const mp = multipart({}, [{ ...PDF, field: "file" }]);
    const up = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/items/${items[0].id}/voucher`,
      headers: { cookie, "content-type": mp.contentType },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(200);
    // Physical items refuse a voucher PDF.
    const mp2 = multipart({}, [{ ...PDF, field: "file" }]);
    const up2 = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/items/${items[1].id}/voucher`,
      headers: { cookie, "content-type": mp2.contentType },
      payload: mp2.payload,
    });
    expect(up2.statusCode).toBe(400);
    const send = await app.inject({ method: "POST", url: `/api/host/invoices/${invoice.id}/send-email`, headers: { cookie } });
    expect(send.json()).toMatchObject({ emailStatus: "sent", emailed: 1 });
  });

  it("physical-only win: email says collect at the desk, no attachments", async () => {
    const { code, eventId } = await emptyEvent();
    await addItem(code, { title: "Water filter", kind: "physical" });
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    const g = await joinGuest(app, code, ph(3), "Carl", "carl@example.org");
    await bid(app, code, g.token, live.items[0].id, 1000);
    await closeEvent(eventId);
    const inv = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
    const res = await confirm(inv.invoices[0].id, { method: "cash" });
    expect(res.json()).toMatchObject({ emailStatus: "sent", emailed: 0 });
    expect(mailbox.sent[0].attachments).toEqual([]);
    expect(mailbox.sent[0].text).toMatch(/collect your item at the desk/);
  });
});

describe("handover", () => {
  it("only after payment; records time and host; can be undone; summary counts it", async () => {
    const { code, invoice, items } = await wonEvent({ email: "anna@example.org" });
    const url = `/api/host/invoices/${invoice.id}/lines/${items[1].id}/handover`;
    expect((await app.inject({ method: "POST", url, headers: { cookie }, payload: { handedOver: true } })).statusCode).toBe(409);
    await confirm(invoice.id, { method: "cash" });
    const res = await app.inject({ method: "POST", url, headers: { cookie }, payload: { handedOver: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().handedOverAt).toBeTruthy();
    const list = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
    expect(list.summary).toEqual({ invoices: 1, paid: 1, totalAmount: 2000, paidAmount: 2000, items: 2, handedOver: 1 });
    expect(list.invoices[0].paymentMethod).toBe("cash");
    const undo = await app.inject({ method: "POST", url, headers: { cookie }, payload: { handedOver: false } });
    expect(undo.json().handedOverAt).toBeNull();
    const notOnInvoice = await app.inject({
      method: "POST",
      url: `/api/host/invoices/${invoice.id}/lines/00000000-0000-0000-0000-000000000000/handover`,
      headers: { cookie },
      payload: { handedOver: true },
    });
    expect(notOnInvoice.statusCode).toBe(404);
  });
});

describe("results export", () => {
  async function exportedEvent() {
    const { code, eventId } = await emptyEvent();
    await addItem(code, { title: "=HYPERLINK(\"http://evil\")", sponsorName: "Grand Hotel" }, [PDF]);
    await addItem(code, { title: "Jersey", kind: "physical" });
    await addItem(code, { title: "Unsold lot" });
    const live = (await app.inject({ method: "GET", url: `/api/events/${code}` })).json();
    const a = await joinGuest(app, code, ph(1), "Anna", "anna@example.org");
    const b = await joinGuest(app, code, ph(2), "Ben");
    await bid(app, code, a.token, live.items[0].id, 1000);
    await bid(app, code, b.token, live.items[1].id, 1500);
    await closeEvent(eventId);
    const inv = (await app.inject({ method: "GET", url: `/api/host/events/${code}/invoices`, headers: { cookie } })).json();
    const annaInv = inv.invoices.find((i: { guestName: string }) => i.guestName === "Anna");
    await confirm(annaInv.id, { method: "cash" });
    await app.inject({
      method: "POST",
      url: `/api/host/invoices/${annaInv.id}/lines/${live.items[0].id}/handover`,
      headers: { cookie },
      payload: { handedOver: true },
    });
    return code;
  }

  it("CSV: one row per lot, payment + handover columns, formula injection neutralised", async () => {
    const code = await exportedEvent();
    const res = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.csv`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/results-.*\.csv/);
    const lines = res.body.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      '"Lot","Item","Type","Sponsor","Winner","Phone","Email","Amount","Currency","Paid","Method","Paid at (Asia/Bangkok, UTC+7)","Handed over","Handed over at (Asia/Bangkok, UTC+7)"',
    );
    expect(lines).toHaveLength(4);
    // Phones: readable national format, no leading + and no visible apostrophe.
    expect(lines[1]).toMatch(/^"1","'=HYPERLINK\(""http:\/\/evil""\)","voucher","Grand Hotel","Anna","081 000 0001","anna@example.org","1000","THB","yes","Cash","(\d{4}-\d\d-\d\d \d\d:\d\d)","yes","\d{4}-\d\d-\d\d \d\d:\d\d"$/);
    expect(lines[2]).toMatch(/^"2","Jersey","physical","","Ben","081 000 0002","","1500","THB","no","","","no",""$/);
    // Paid at is Bangkok wall time (UTC+7), not UTC.
    const paidAt = (await pool.query("SELECT paid_at FROM invoices WHERE status = 'paid'")).rows[0].paid_at as Date;
    const bkk = new Date(paidAt.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    expect(lines[1]).toContain(`"Cash","${bkk}"`);
    expect(lines[3]).toBe('"3","Unsold lot","voucher","","","","","","THB","","","","",""');
  });

  it("XLSX opens with the same data (phone kept as text) and a total row; host-only", async () => {
    const code = await exportedEvent();
    const res = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.xlsx`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Results")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Lot");
    expect(ws.getRow(2).getCell(6).value).toBe("+66810000001");
    expect(ws.getColumn(6).numFmt).toBe("@");
    expect(ws.getRow(1).getCell(12).value).toBe("Paid at (Asia/Bangkok, UTC+7)");
    const paidAt = (await pool.query("SELECT paid_at FROM invoices WHERE status = 'paid'")).rows[0].paid_at as Date;
    const cell = ws.getRow(2).getCell(12).value as Date;
    // Excel dates carry no zone: the cell holds the Bangkok wall time.
    expect(cell.toISOString().slice(0, 16)).toBe(new Date(paidAt.getTime() + 7 * 3600_000).toISOString().slice(0, 16));
    expect(ws.getRow(2).getCell(8).value).toBe(1000);
    expect(ws.getRow(5).getCell(8).value).toBe(2500);
    const anon = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.xlsx` });
    expect(anon.statusCode).toBe(401);
    const bad = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.pdf`, headers: { cookie } });
    expect(bad.statusCode).toBe(404);
  });
});

describe("csv phone format", () => {
  it("is readable and never starts with a formula character", async () => {
    const { csvPhone } = await import("../src/phone.js");
    expect(csvPhone("+66812345678")).toBe("081 234 5678");
    expect(csvPhone("+4915123456789")).toBe("(+49) 1512 3456789");
    expect(csvPhone("")).toBe("");
    for (const p of ["+66812345678", "+4915123456789", "+14155550123"]) expect(csvPhone(p)).not.toMatch(/^[=+\-@]/);
  });
});
