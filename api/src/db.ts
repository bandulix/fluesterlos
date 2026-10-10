import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://fluesterlos:fluesterlos@localhost:5432/fluesterlos";

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export async function migrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE events ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'THB';

    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      photo_url TEXT,
      starting_bid NUMERIC(12,2) NOT NULL,
      min_increment NUMERIC(12,2) NOT NULL,
      buy_now NUMERIC(12,2),
      sort_order INT NOT NULL DEFAULT 0,
      voucher_pdf_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE items ADD COLUMN IF NOT EXISTS voucher_pdf_path TEXT;

    CREATE TABLE IF NOT EXISTS guests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Set when a device first receives this guest's token. Existing rows count as claimed
    -- (DEFAULT fills them once); host-added guests stay NULL until they join themselves.
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT now();
    ALTER TABLE guests ALTER COLUMN claimed_at DROP DEFAULT;

    -- 6-digit codes emailed when an already-claimed email joins from a new device.
    CREATE TABLE IF NOT EXISTS guest_login_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bids (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS host_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS host_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      host_user_id UUID NOT NULL REFERENCES host_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS host_settings (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      promptpay_id TEXT,
      payee_name TEXT,
      qr_image_path TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO host_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      total NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('unpaid', 'payslip_uploaded', 'paid')),
      payslip_path TEXT,
      paid_at TIMESTAMPTZ,
      vouchers_emailed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, guest_id)
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      PRIMARY KEY (invoice_id, item_id)
    );

    -- Phase 2: physical prizes, sponsors, phone-keyed guests, payment desk.
    CREATE TABLE IF NOT EXISTS sponsors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      logo_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sponsors_name_uq ON sponsors (lower(name));

    ALTER TABLE items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'voucher';
    ALTER TABLE items DROP CONSTRAINT IF EXISTS items_kind_check;
    ALTER TABLE items ADD CONSTRAINT items_kind_check CHECK (kind IN ('voucher', 'physical'));
    ALTER TABLE items ADD COLUMN IF NOT EXISTS sponsor_id UUID REFERENCES sponsors(id) ON DELETE SET NULL;

    -- Guests are keyed by phone (E.164) per event; email is optional (voucher delivery).
    -- Older email-keyed guests keep their row and token; phone stays NULL until they add one.
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE guests ALTER COLUMN email DROP NOT NULL;
    ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_event_id_email_key;
    CREATE UNIQUE INDEX IF NOT EXISTS guests_event_phone_uq ON guests (event_id, phone) WHERE phone IS NOT NULL;
    CREATE INDEX IF NOT EXISTS guests_event_email_idx ON guests (event_id, lower(email));

    -- Plain code kept only while pending so hosts can read it out at the help desk.
    ALTER TABLE guest_login_codes ADD COLUMN IF NOT EXISTS desk_code TEXT;
    ALTER TABLE guest_login_codes ADD COLUMN IF NOT EXISTS delivery TEXT NOT NULL DEFAULT 'desk';

    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT;
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payment_method_check;
    ALTER TABLE invoices ADD CONSTRAINT invoices_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('cash', 'bank_transfer', 'promptpay'));
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_by TEXT;
    ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMPTZ;
    ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS handed_over_by TEXT;

    -- Click-test round 1: event time zone (display/input only; times stay UTC) and early close.
    ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS closed_early_at TIMESTAMPTZ;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS closed_by TEXT;

    -- Click-test round 2: devices a guest has authenticated on (hash of an httpOnly cookie id).
    CREATE TABLE IF NOT EXISTS guest_devices (
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      device_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guest_id, device_hash)
    );

    CREATE INDEX IF NOT EXISTS bids_item_created_idx ON bids(item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS items_event_sort_idx ON items(event_id, sort_order);
    CREATE INDEX IF NOT EXISTS host_sessions_user_idx ON host_sessions(host_user_id);
    CREATE INDEX IF NOT EXISTS host_sessions_expires_idx ON host_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS invoices_event_idx ON invoices(event_id);
    CREATE INDEX IF NOT EXISTS guest_login_codes_guest_idx ON guest_login_codes(guest_id, created_at DESC);
  `);
}
