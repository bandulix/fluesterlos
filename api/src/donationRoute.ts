import { pool } from "./db.js";
import { money, type Currency } from "./auction.js";
import { promptPayPayload } from "./promptpay.js";

export const DEFAULT_DONATION_THRESHOLD = 10000;

export type DonationChannel = "mercy" | "wolfgang";
export type DonationRouteSource = "threshold" | "override";

/** Channel titles. These are labels, not account numbers, and they are not stored until a host types them. */
export const CHANNEL_LABEL: Record<DonationChannel, string> = {
  mercy: "Mercy Centre",
  wolfgang: "Wolfgang's QR",
};

/**
 * Empty-field hints for the host form. Example data only: nothing here is written to the database.
 */
export const DONATION_PLACEHOLDERS = {
  example: true as const,
  label: "Example data — not a real account",
  mercyDisplayName: "Mercy Centre",
  mercyInstructions: "Transfer the donation total and keep the slip for the charity.",
  mercyBankDetails: "Bank name\nAccount name\nAccount number",
  mercyPaymentLink: "https://example.org/donate",
  mercyReceiptNote: "A donation receipt is issued by Mercy Centre.",
  wolfgangDisplayName: "Wolfgang's QR",
  wolfgangPromptpayId: "08xxxxxxxx",
};

export type DonationSettings = {
  threshold: number;
  mercyDisplayName: string;
  mercyInstructions: string;
  mercyBankDetails: string;
  mercyPaymentLink: string;
  mercyQrPath: string | null;
  mercyReceiptNote: string;
  wolfgangDisplayName: string;
  wolfgangQrPath: string | null;
  wolfgangPromptpayId: string | null;
};

export function donationChannel(opts: {
  donationsTotal: number | string;
  threshold?: number | string | null;
  override?: string | null;
}): { channel: DonationChannel; source: DonationRouteSource; threshold: number } {
  const threshold =
    opts.threshold == null || opts.threshold === "" ? DEFAULT_DONATION_THRESHOLD : money(opts.threshold);
  const total = money(opts.donationsTotal);
  if (opts.override === "mercy" || opts.override === "wolfgang") {
    return { channel: opts.override, source: "override", threshold };
  }
  return {
    channel: total + 0.001 >= threshold ? "mercy" : "wolfgang",
    source: "threshold",
    threshold,
  };
}

export function channelLabel(channel: DonationChannel, displayName: string): string {
  const typed = displayName.trim();
  return typed || CHANNEL_LABEL[channel];
}

export function safePaymentLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function getDonationSettings(): Promise<DonationSettings> {
  const { rows } = await pool.query("SELECT * FROM host_settings WHERE id = 1");
  const row = rows[0] ?? {};
  return {
    threshold: row.donation_threshold == null ? DEFAULT_DONATION_THRESHOLD : money(row.donation_threshold),
    mercyDisplayName: row.mercy_display_name ?? "",
    mercyInstructions: row.mercy_instructions ?? "",
    mercyBankDetails: row.mercy_bank_details ?? "",
    mercyPaymentLink: row.mercy_payment_link ?? "",
    mercyQrPath: row.mercy_qr_path ?? null,
    mercyReceiptNote: row.mercy_receipt_note ?? "",
    wolfgangDisplayName: row.wolfgang_display_name ?? "",
    wolfgangQrPath: row.wolfgang_qr_path ?? null,
    wolfgangPromptpayId: row.wolfgang_promptpay_id ?? null,
  };
}

export type GuestDonationRoute = {
  guestId: string;
  name: string;
  phone: string | null;
  donationsTotal: number;
  threshold: number;
  channel: DonationChannel;
  source: DonationRouteSource;
  override: DonationChannel | null;
  label: string;
  audit: Array<{
    id: string;
    action: string;
    channel: string | null;
    previousChannel: string | null;
    reason: string | null;
    actor: string;
    donationsTotal: number | null;
    createdAt: string;
  }>;
};

export async function listDonationRoutes(eventId: string): Promise<GuestDonationRoute[]> {
  const settings = await getDonationSettings();
  const totals = await pool.query(
    `SELECT g.id AS guest_id, g.name, g.phone,
            COALESCE(SUM(p.amount) FILTER (WHERE p.undone_at IS NULL AND p.voided_at IS NULL), 0) AS total,
            o.channel AS override
     FROM guests g
     JOIN pledges p ON p.guest_id = g.id
     JOIN needs n ON n.id = p.need_id AND n.event_id = g.event_id
     LEFT JOIN donation_route_overrides o ON o.event_id = g.event_id AND o.guest_id = g.id
     WHERE g.event_id = $1
     GROUP BY g.id, g.name, g.phone, o.channel
     ORDER BY g.name, g.id`,
    [eventId],
  );
  const audits = await pool.query(
    `SELECT id, guest_id, action, channel, previous_channel, reason, actor, donations_total, created_at
     FROM donation_route_audit
     WHERE event_id = $1
     ORDER BY created_at DESC`,
    [eventId],
  );
  const auditByGuest = new Map<string, GuestDonationRoute["audit"]>();
  for (const row of audits.rows) {
    const list = auditByGuest.get(row.guest_id) ?? [];
    if (list.length < 6) {
      list.push({
        id: row.id,
        action: row.action,
        channel: row.channel,
        previousChannel: row.previous_channel,
        reason: row.reason,
        actor: row.actor,
        donationsTotal: row.donations_total == null ? null : money(row.donations_total),
        createdAt: new Date(row.created_at).toISOString(),
      });
    }
    auditByGuest.set(row.guest_id, list);
  }
  return totals.rows.map((row) => {
    const route = donationChannel({
      donationsTotal: row.total,
      threshold: settings.threshold,
      override: row.override,
    });
    const display = route.channel === "mercy" ? settings.mercyDisplayName : settings.wolfgangDisplayName;
    return {
      guestId: row.guest_id,
      name: row.name,
      phone: row.phone,
      donationsTotal: money(row.total),
      threshold: route.threshold,
      channel: route.channel,
      source: route.source,
      override: row.override === "mercy" || row.override === "wolfgang" ? row.override : null,
      label: channelLabel(route.channel, display),
      audit: auditByGuest.get(row.guest_id) ?? [],
    };
  });
}

export async function routeForGuest(eventId: string, guestId: string) {
  const routes = await listDonationRoutes(eventId);
  return routes.find((r) => r.guestId === guestId) ?? null;
}

export async function setDonationRouteOverride(opts: {
  eventId: string;
  guestId: string;
  channel: DonationChannel | null;
  reason: string;
  actor: string;
}): Promise<GuestDonationRoute> {
  const guest = await pool.query("SELECT id FROM guests WHERE id = $1 AND event_id = $2", [opts.guestId, opts.eventId]);
  if (!guest.rows[0]) {
    const err = new Error("Guest not found");
    throw Object.assign(err, { statusCode: 404 });
  }
  const before = await routeForGuest(opts.eventId, opts.guestId);
  const previous = before?.override ?? null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (opts.channel == null) {
      await client.query("DELETE FROM donation_route_overrides WHERE event_id = $1 AND guest_id = $2", [
        opts.eventId,
        opts.guestId,
      ]);
    } else {
      await client.query(
        `INSERT INTO donation_route_overrides (event_id, guest_id, channel)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, guest_id) DO UPDATE SET channel = EXCLUDED.channel, updated_at = now()`,
        [opts.eventId, opts.guestId, opts.channel],
      );
    }
    await client.query(
      `INSERT INTO donation_route_audit (event_id, guest_id, action, channel, previous_channel, reason, actor, donations_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        opts.eventId,
        opts.guestId,
        opts.channel == null ? "cleared" : "override",
        opts.channel,
        previous,
        opts.reason,
        opts.actor,
        before?.donationsTotal ?? null,
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const next = await routeForGuest(opts.eventId, opts.guestId);
  if (!next) {
    const err = new Error("Guest not found");
    throw Object.assign(err, { statusCode: 404 });
  }
  return next;
}

export function exportChannelLabel(route: { channel: DonationChannel; source: DonationRouteSource; label: string }): string {
  return route.source === "override" ? `${route.label} (override)` : route.label;
}

/** What the donations section of an invoice tells the guest to do. Auction lots are not included. */
export function buildDonationPayment(opts: {
  eventCode: string;
  donationsTotal: number;
  route: { channel: DonationChannel; source: DonationRouteSource; threshold: number; label: string };
  currency: Currency;
  settings: DonationSettings;
}) {
  if (!(opts.donationsTotal > 0)) return null;
  const { channel } = opts.route;
  const mercy = channel === "mercy";
  const hasQr = mercy ? Boolean(opts.settings.mercyQrPath) : Boolean(opts.settings.wolfgangQrPath);
  let promptpayPayload: string | null = null;
  if (!mercy && !hasQr && opts.settings.wolfgangPromptpayId && opts.currency === "THB") {
    try {
      promptpayPayload = promptPayPayload(opts.settings.wolfgangPromptpayId, opts.donationsTotal);
    } catch {
      promptpayPayload = null;
    }
  }
  const note = mercy
    ? opts.settings.mercyReceiptNote.trim() || DONATION_PLACEHOLDERS.mercyReceiptNote
    : "";
  return {
    channel,
    source: opts.route.source,
    threshold: opts.route.threshold,
    donationsTotal: money(opts.donationsTotal),
    displayName: opts.route.label,
    instructions: mercy ? opts.settings.mercyInstructions : "",
    bankDetails: mercy ? opts.settings.mercyBankDetails : "",
    paymentLink: mercy ? safePaymentLink(opts.settings.mercyPaymentLink) : null,
    receiptNote: note,
    needsReceipt: mercy,
    hasQrImage: hasQr,
    qrImageUrl: hasQr ? `/api/events/${opts.eventCode}/donation-qr/${channel}` : null,
    promptpayPayload,
    detailsMissing: mercy
      ? !opts.settings.mercyInstructions.trim() &&
        !opts.settings.mercyBankDetails.trim() &&
        !safePaymentLink(opts.settings.mercyPaymentLink) &&
        !hasQr
      : !hasQr && !promptpayPayload,
  };
}
