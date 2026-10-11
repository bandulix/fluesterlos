import { describe, expect, it } from "vitest";
import { afterPaidMessage, deskHandoverText, handoverToastText, HostInvoice, voucherPdfWarning } from "../src/lib/deskText";
import { draftSponsorsBefore, findDraftSponsor } from "../src/lib/sponsorDrafts";

function invoice(lines: Array<Partial<HostInvoice["lines"][number]>>, email: string | null = null): HostInvoice {
  return {
    id: "inv1",
    guestId: "g1",
    guestName: "Guest",
    guestEmail: email,
    guestPhone: null,
    total: 100,
    status: "paid",
    paymentMethod: "cash",
    paidBy: null,
    hasPayslip: false,
    paidAt: null,
    vouchersEmailedAt: null,
    lines: lines.map((l, i) => ({
      itemId: `item${i}`,
      title: `Item ${i}`,
      description: "",
      amount: 50,
      kind: "voucher",
      hasVoucher: true,
      sponsorName: null,
      handedOverAt: null,
      ...l,
    })),
  };
}

describe("payment desk texts", () => {
  it("never says print/show for a voucher without a PDF — warns instead", () => {
    const inv = invoice([{ title: "Brunch for 4", hasVoucher: false }]);
    expect(deskHandoverText(inv)).toBe("");
    expect(voucherPdfWarning(inv)).toMatch(/Voucher PDF missing: Brunch for 4 — attach it .* before handing over or emailing/);
    const msg = afterPaidMessage(inv, "no_email");
    expect(msg).not.toMatch(/print\/show/);
    expect(msg).toMatch(/Voucher PDF missing: Brunch for 4/);
  });

  it("still lists vouchers that have a PDF (no email) and physical prizes", () => {
    const inv = invoice([{ title: "Spa", hasVoucher: true }, { title: "Brunch", hasVoucher: false }, { title: "Jersey", kind: "physical", hasVoucher: false }]);
    expect(deskHandoverText(inv)).toBe("At the desk — print/show voucher(s): Spa; hand over: Jersey.");
    expect(voucherPdfWarning(inv)).toContain("Brunch");
    expect(voucherPdfWarning(inv)).not.toContain("Jersey");
  });

  it("drops handed-over items from the desk hint and disappears when all are handed over", () => {
    const inv = invoice([{ itemId: "i1", title: "Spa", hasVoucher: true }, { itemId: "i2", title: "Jersey", kind: "physical", hasVoucher: false }]);
    const one = { ...inv, lines: inv.lines.map((l) => (l.title === "Jersey" ? { ...l, handedOverAt: "2026-10-11T10:00:00Z" } : l)) };
    expect(deskHandoverText(one)).toBe("At the desk — print/show voucher(s): Spa.");
    const all = { ...inv, lines: inv.lines.map((l) => ({ ...l, handedOverAt: "2026-10-11T10:00:00Z" })) };
    expect(deskHandoverText(all)).toBe("");
  });

  it("email held because of a missing PDF: one clear message", () => {
    const inv = invoice([{ title: "Brunch", hasVoucher: false }], "g@example.org");
    const msg = afterPaidMessage(inv, "voucher_pdf_missing");
    expect(msg).toMatch(/Email held until the PDF is attached/);
    expect(msg).toMatch(/Voucher PDF missing: Brunch/);
  });

  it("no warning when every voucher has its PDF", () => {
    expect(voucherPdfWarning(invoice([{ hasVoucher: true }]))).toBe("");
    expect(afterPaidMessage(invoice([{ hasVoucher: true }], "g@example.org"), "sent", 1)).toBe(
      "Guest: marked paid. Winner email sent with 1 voucher PDF(s).",
    );
  });

  it("handover toast names the item and guest", () => {
    const inv = invoice([{ title: "Spa" }]);
    expect(handoverToastText(inv, "item0", true)).toBe("✓ Handed over: Spa → Guest");
    expect(handoverToastText(inv, "item0", false)).toBe("Handover undone: Spa → Guest");
    expect(handoverToastText(undefined, "x", true)).toBe("✓ Handed over: item");
  });
});

describe("sponsor suggestions from earlier items of the same form", () => {
  const logo = { name: "logo.png" } as File;
  const items = [
    { title: "Spa day", sponsorName: "Grand Hotel", sponsorLogo: logo },
    { title: "", sponsorName: "Ghost Sponsor", sponsorLogo: null }, // no title → not created
    { title: "Dinner", sponsorName: "grand hotel ", sponsorLogo: null },
    { title: "Jersey", sponsorName: "FC Club", sponsorLogo: null },
    { title: "Next", sponsorName: "", sponsorLogo: null },
  ];

  it("offers sponsors typed for earlier items only, deduped, with the chosen logo", () => {
    expect(draftSponsorsBefore(items, 0)).toEqual([]);
    const drafts = draftSponsorsBefore(items, 4);
    expect(drafts.map((d) => d.name)).toEqual(["Grand Hotel", "FC Club"]);
    expect(drafts[0].logo).toBe(logo);
    expect(drafts[0].fromItem).toBe(0);
    expect(findDraftSponsor(drafts, "GRAND HOTEL")?.logo).toBe(logo);
    expect(findDraftSponsor(drafts, "Ghost Sponsor")).toBeUndefined();
  });

  it("takes the logo from a later earlier-item if the first one had none", () => {
    const drafts = draftSponsorsBefore(
      [
        { title: "A", sponsorName: "Cafe", sponsorLogo: null },
        { title: "B", sponsorName: "Cafe", sponsorLogo: logo },
      ],
      2,
    );
    expect(drafts).toEqual([{ name: "Cafe", logo, fromItem: 1 }]);
  });
});
