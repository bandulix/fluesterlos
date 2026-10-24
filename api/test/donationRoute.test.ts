import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { CHANNEL_LABEL, donationChannel, DONATION_PLACEHOLDERS } from "../src/donationRoute.js";
import { promptPayPayload } from "../src/promptpay.js";
import { closeEvent, createOpenEvent, freshApp, hostCookie, joinGuest, ph, pool } from "./helpers.js";

let app: FastifyInstance;
let cookie: string;
let code: string;
let eventId: string;

beforeEach(async () => {
  await app?.close();
  app = await freshApp();
  cookie = await hostCookie(app);
  const ev = await createOpenEvent(app, cookie, [{ title: "Jersey", startingBid: 2000, minIncrement: 200 }]);
  code = ev.code;
  eventId = ev.eventId;
});

afterAll(async () => {
  await app?.close();
  await pool.end();
});

async function addNeed() {
  const res = await app.inject({
    method: "POST",
    url: `/api/host/events/${code}/needs`,
    headers: { cookie },
    payload: {
      title: "A playground for the school",
      beneficiary: "Thai.GER charity",
      description: "Example data.",
      targetAmount: 200000,
      minPledge: 1,
      suggestedAmounts: [1000, 5000, 10000],
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

function pledge(token: string, needId: string, amount: number) {
  return app.inject({
    method: "POST",
    url: `/api/events/${code}/pledges`,
    headers: { "x-guest-token": token },
    payload: { needId, amount },
  });
}

async function guestRoute(guestId: string) {
  const res = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return (res.json().donationRoutes as Array<{ guestId: string; donationsTotal: number; channel: string; source: string; label: string }>).find(
    (r) => r.guestId === guestId,
  );
}

describe("donation channel threshold", () => {
  it("sends 9999 to Wolfgang, and 10000 and 10001 to Mercy Centre", () => {
    expect(donationChannel({ donationsTotal: 9999 }).channel).toBe("wolfgang");
    expect(donationChannel({ donationsTotal: 10000 })).toMatchObject({ channel: "mercy", source: "threshold", threshold: 10000 });
    expect(donationChannel({ donationsTotal: 10001 }).channel).toBe("mercy");
    expect(donationChannel({ donationsTotal: 15000, override: "wolfgang" })).toMatchObject({ channel: "wolfgang", source: "override" });
    expect(donationChannel({ donationsTotal: 100, threshold: 500 }).channel).toBe("wolfgang");
    expect(donationChannel({ donationsTotal: 500, threshold: 500 }).channel).toBe("mercy");
  });

  it("ships empty channel settings and example placeholders that are not saved", async () => {
    const res = await app.inject({ method: "GET", url: "/api/host/settings", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.donationThreshold).toBe(10000);
    expect(body.mercyDisplayName).toBe("");
    expect(body.mercyBankDetails).toBe("");
    expect(body.mercyPaymentLink).toBe("");
    expect(body.wolfgangPromptpayId).toBe("");
    expect(body.wolfgangDisplayName).toBe("");
    expect(body.donationPlaceholders).toMatchObject({ example: true, label: DONATION_PLACEHOLDERS.label });
    expect(JSON.stringify(body.donationPlaceholders)).not.toMatch(/\d{8,}/);
    const stored = await pool.query(
      "SELECT mercy_display_name, mercy_bank_details, wolfgang_promptpay_id FROM host_settings WHERE id = 1",
    );
    expect(stored.rows[0]).toMatchObject({
      mercy_display_name: "",
      mercy_bank_details: "",
      wolfgang_promptpay_id: null,
    });
  });

  it("moves a guest to Mercy Centre once several pledges cross 10000, and back when one is voided", async () => {
    const needId = await addNeed();
    const guest = await joinGuest(app, code, ph(21), "Table 4");
    expect((await pledge(guest.token, needId, 6000)).statusCode).toBe(200);
    expect(await guestRoute(guest.id)).toMatchObject({ donationsTotal: 6000, channel: "wolfgang", source: "threshold" });
    expect((await pledge(guest.token, needId, 5000)).statusCode).toBe(200);
    expect(await guestRoute(guest.id)).toMatchObject({ donationsTotal: 11000, channel: "mercy", source: "threshold" });

    await closeEvent(eventId);
    const before = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": guest.token },
    });
    expect(before.json().invoice.donationsTotal).toBe(11000);
    expect(before.json().invoice.donationPayment).toMatchObject({
      channel: "mercy",
      donationsTotal: 11000,
      needsReceipt: true,
      displayName: "Mercy Centre",
    });
    expect(before.json().invoice.donationPayment.receiptNote).toMatch(/donation receipt/i);

    const host = await app.inject({ method: "GET", url: `/api/host/events/${code}/needs`, headers: { cookie } });
    const pledgeId = host.json().needs[0].pledges.find((p: { amount: number }) => p.amount === 5000).id as string;
    const voided = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/pledges/${pledgeId}/void`,
      headers: { cookie },
      payload: { reason: "Wrong amount" },
    });
    expect(voided.statusCode).toBe(200);
    expect(await guestRoute(guest.id)).toMatchObject({ donationsTotal: 6000, channel: "wolfgang", source: "threshold" });

    const after = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": guest.token },
    });
    expect(after.json().invoice.donationsTotal).toBe(6000);
    expect(after.json().invoice.donationPayment.channel).toBe("wolfgang");
    expect(after.json().invoice.donationPayment.needsReceipt).toBe(false);
    expect(after.json().payment.promptpayPayload == null || after.json().invoice.lines.length === 0).toBe(true);
  });

  it("keeps auction PromptPay on the lots subtotal and routes each donation total", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/host/settings",
      headers: { cookie },
      payload: {
        promptpayId: "0890000000",
        payeeName: "Auction desk",
        wolfgangPromptpayId: "0810000000",
        mercyDisplayName: "Mercy Centre",
        mercyInstructions: "Example transfer instructions.",
        mercyBankDetails: "Example bank\nExample account name\nAccount number",
        mercyReceiptNote: "A donation receipt is issued by Mercy Centre.",
      },
    });
    const needId = await addNeed();
    const items = await app.inject({ method: "GET", url: `/api/events/${code}` });
    const itemId = items.json().items[0].id as string;
    const big = await joinGuest(app, code, ph(22), "Table 7");
    const small = await joinGuest(app, code, ph(23), "Table 3");
    await app.inject({
      method: "POST",
      url: `/api/events/${code}/bids`,
      headers: { "x-guest-token": big.token },
      payload: { itemId, amount: 2000 },
    });
    await pledge(big.token, needId, 9999);
    await pledge(big.token, needId, 1);
    await pledge(small.token, needId, 9999);
    await closeEvent(eventId);

    const mercy = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": big.token },
    });
    expect(mercy.json().invoice.lotsTotal).toBe(2000);
    expect(mercy.json().invoice.donationsTotal).toBe(10000);
    expect(mercy.json().invoice.total).toBe(12000);
    expect(mercy.json().payment.promptpayPayload).toBe(promptPayPayload("0890000000", 2000));
    expect(mercy.json().invoice.donationPayment).toMatchObject({ channel: "mercy", donationsTotal: 10000, needsReceipt: true });
    expect(mercy.json().invoice.donationPayment.promptpayPayload).toBeNull();

    const wolf = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": small.token },
    });
    expect(wolf.json().invoice.lotsTotal).toBe(0);
    expect(wolf.json().invoice.donationsTotal).toBe(9999);
    expect(wolf.json().payment.promptpayPayload).toBeNull();
    expect(wolf.json().invoice.donationPayment).toMatchObject({ channel: "wolfgang", donationsTotal: 9999 });
    expect(wolf.json().invoice.donationPayment.promptpayPayload).toBe(promptPayPayload("0810000000", 9999));

    const over = await joinGuest(app, code, ph(24), "Table 9");
    await pledge(over.token, needId, 10001);
    const justOver = await app.inject({
      method: "GET",
      url: `/api/events/${code}/invoice`,
      headers: { "x-guest-token": over.token },
    });
    expect(justOver.json().invoice.donationPayment.channel).toBe("mercy");
    expect(justOver.json().invoice.donationPayment.donationsTotal).toBe(10001);
  });

  it("lets the host override the channel, and the export names it", async () => {
    const needId = await addNeed();
    const guest = await joinGuest(app, code, ph(25), "Table 8");
    await pledge(guest.token, needId, 10001);
    const missing = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/donation-route`,
      headers: { cookie },
      payload: { guestId: guest.id, channel: "wolfgang" },
    });
    expect(missing.statusCode).toBe(400);
    const overridden = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/donation-route`,
      headers: { cookie },
      payload: { guestId: guest.id, channel: "wolfgang", reason: "Paying cash to Wolfgang at the table" },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().route).toMatchObject({ channel: "wolfgang", source: "override", donationsTotal: 10001 });
    expect(overridden.json().route.audit[0]).toMatchObject({
      action: "override",
      reason: "Paying cash to Wolfgang at the table",
    });

    const csv = await app.inject({ method: "GET", url: `/api/host/events/${code}/results.csv`, headers: { cookie } });
    expect(csv.body).toContain("Payment channel");
    expect(csv.body).toContain(`${CHANNEL_LABEL.wolfgang} (override)`);

    const cleared = await app.inject({
      method: "POST",
      url: `/api/host/events/${code}/donation-route`,
      headers: { cookie },
      payload: { guestId: guest.id, channel: null, reason: "Use the threshold again" },
    });
    expect(cleared.json().route).toMatchObject({ channel: "mercy", source: "threshold" });
    expect(cleared.json().route.audit[0].action).toBe("cleared");
  });
});
