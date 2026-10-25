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
    -- Item import: retail value (shown to guests as "Value ฿X") and host-only notes.
    ALTER TABLE items ADD COLUMN IF NOT EXISTS retail_value NUMERIC(12,2);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

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

    -- Round 3: neutral per-event guest number ("Guest 7") instead of phone digits on public views.
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS guest_no INT;
    UPDATE guests g SET guest_no = sub.no
    FROM (
      SELECT x.id,
             COALESCE((SELECT MAX(y.guest_no) FROM guests y WHERE y.event_id = x.event_id), 0)
               + row_number() OVER (PARTITION BY x.event_id ORDER BY x.created_at, x.id) AS no
      FROM guests x WHERE x.guest_no IS NULL
    ) sub
    WHERE g.id = sub.id;
    CREATE UNIQUE INDEX IF NOT EXISTS guests_event_no_uq ON guests (event_id, guest_no);
    -- Default board names that leaked phone digits ("Guest …1234") or email local parts.
    UPDATE guests SET name = 'Guest ' || guest_no
    WHERE name = '' OR name LIKE 'Guest …%' OR (email IS NOT NULL AND name = split_part(email, '@', 1));

    CREATE OR REPLACE FUNCTION fl_guest_number() RETURNS trigger AS $fn$
    BEGIN
      IF NEW.guest_no IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('fl_guest_no:' || NEW.event_id::text));
        SELECT COALESCE(MAX(guest_no), 0) + 1 INTO NEW.guest_no FROM guests WHERE event_id = NEW.event_id;
      END IF;
      IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
        NEW.name := 'Guest ' || NEW.guest_no;
      END IF;
      RETURN NEW;
    END
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS guests_number_trg ON guests;
    CREATE TRIGGER guests_number_trg BEFORE INSERT ON guests FOR EACH ROW EXECUTE FUNCTION fl_guest_number();

    CREATE INDEX IF NOT EXISTS bids_item_created_idx ON bids(item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS items_event_sort_idx ON items(event_id, sort_order);
    CREATE INDEX IF NOT EXISTS host_sessions_user_idx ON host_sessions(host_user_id);
    CREATE INDEX IF NOT EXISTS host_sessions_expires_idx ON host_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS invoices_event_idx ON invoices(event_id);
    CREATE INDEX IF NOT EXISTS guest_login_codes_guest_idx ON guest_login_codes(guest_id, created_at DESC);

    -- Fund-a-Need: shared pledges, independent of the auction clock unless the host sets an end.
    ALTER TABLE events ADD COLUMN IF NOT EXISTS needs_ends_at TIMESTAMPTZ;
    -- UUID of the need featured on the big screen. No FK: needs also reference events.
    ALTER TABLE events ADD COLUMN IF NOT EXISTS spotlight_need_id UUID;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS receipt_name TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_name TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lots_total NUMERIC(12,2);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS donations_total NUMERIC(12,2);

    CREATE TABLE IF NOT EXISTS needs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      beneficiary TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      photo_url TEXT,
      target_amount NUMERIC(12,2) NOT NULL,
      min_pledge NUMERIC(12,2) NOT NULL,
      suggested_amounts JSONB NOT NULL DEFAULT '[1000,5000,10000,25000]'::jsonb,
      unit_label TEXT,
      unit_amount NUMERIC(12,2),
      cap_at_target BOOLEAN NOT NULL DEFAULT false,
      ends_at TIMESTAMPTZ,
      hidden BOOLEAN NOT NULL DEFAULT false,
      closed_at TIMESTAMPTZ,
      sort_order INT NOT NULL DEFAULT 0,
      example BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pledges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      need_id UUID NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      units INT CHECK (units IS NULL OR units > 0),
      anonymous BOOLEAN NOT NULL DEFAULT false,
      undone_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      voided_by TEXT,
      void_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pledge_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pledge_id UUID REFERENCES pledges(id) ON DELETE SET NULL,
      need_id UUID NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'undone', 'corrected', 'voided')),
      actor TEXT NOT NULL,
      amount NUMERIC(12,2),
      previous_amount NUMERIC(12,2),
      units INT,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS invoice_donations (
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      need_id UUID NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      beneficiary TEXT NOT NULL DEFAULT '',
      amount NUMERIC(12,2) NOT NULL,
      PRIMARY KEY (invoice_id, need_id)
    );

    CREATE INDEX IF NOT EXISTS needs_event_sort_idx ON needs(event_id, sort_order);
    CREATE INDEX IF NOT EXISTS pledges_need_active_idx ON pledges(need_id) WHERE undone_at IS NULL AND voided_at IS NULL;
    CREATE INDEX IF NOT EXISTS pledges_guest_idx ON pledges(guest_id);
    CREATE INDEX IF NOT EXISTS pledge_audit_need_idx ON pledge_audit(need_id, created_at DESC);

    -- Donation payment channels. Empty until the host fills them in. Threshold 10000:
    -- a guest's donation total at or above it is paid via Mercy Centre; below it, via Wolfgang's QR.
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS donation_threshold NUMERIC(12,2) NOT NULL DEFAULT 10000;
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_display_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_instructions TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_bank_details TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_payment_link TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_qr_path TEXT;
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS mercy_receipt_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS wolfgang_display_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS wolfgang_qr_path TEXT;
    ALTER TABLE host_settings ADD COLUMN IF NOT EXISTS wolfgang_promptpay_id TEXT;

    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS donation_channel TEXT;
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_donation_channel_check;
    ALTER TABLE invoices ADD CONSTRAINT invoices_donation_channel_check
      CHECK (donation_channel IS NULL OR donation_channel IN ('mercy', 'wolfgang'));
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS donation_channel_source TEXT;
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_donation_channel_source_check;
    ALTER TABLE invoices ADD CONSTRAINT invoices_donation_channel_source_check
      CHECK (donation_channel_source IS NULL OR donation_channel_source IN ('threshold', 'override'));

    CREATE TABLE IF NOT EXISTS donation_route_overrides (
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('mercy', 'wolfgang')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, guest_id)
    );

    CREATE TABLE IF NOT EXISTS donation_route_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('override', 'cleared')),
      channel TEXT,
      previous_channel TEXT,
      reason TEXT,
      actor TEXT NOT NULL,
      donations_total NUMERIC(12,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS donation_route_audit_event_idx ON donation_route_audit(event_id, created_at DESC);

    -- Donor recognition is opt-in. Defaults: not named, amount hidden, feature on for the event.
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS recognize_public BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS public_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS show_pledge_amount BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS recognition_hidden BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS recognition_name TEXT NOT NULL DEFAULT '';
    -- Pledges that already asked to be named keep that choice, under the guest's own name.
    UPDATE guests g
    SET recognize_public = true,
        public_name = g.name
    WHERE g.recognize_public = false
      AND btrim(g.public_name) = ''
      AND btrim(g.recognition_name) = ''
      AND EXISTS (
        SELECT 1 FROM pledges p
        WHERE p.guest_id = g.id AND p.anonymous = false AND p.undone_at IS NULL AND p.voided_at IS NULL
      );

    ALTER TABLE events ADD COLUMN IF NOT EXISTS donor_recognition BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS top_donors_screen BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS top_donors_limit INT NOT NULL DEFAULT 10;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS spotlight_top_donors BOOLEAN NOT NULL DEFAULT false;
    -- Big-screen language. Guest phones keep their own choice. both = English with Thai underneath.
    ALTER TABLE events ADD COLUMN IF NOT EXISTS screen_language TEXT NOT NULL DEFAULT 'en';

    CREATE TABLE IF NOT EXISTS recognition_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('guest_update', 'host_edit', 'host_hide', 'host_restore')),
      public_name TEXT,
      previous_name TEXT,
      recognize_public BOOLEAN,
      show_amount BOOLEAN,
      hidden BOOLEAN,
      reason TEXT,
      actor TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS recognition_audit_event_idx ON recognition_audit(event_id, created_at DESC);

    -- Live paddle raise during the gala speech. One session per event.
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_status TEXT NOT NULL DEFAULT 'off';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_need_id UUID;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_levels JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_level_index INT NOT NULL DEFAULT 0;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_goal NUMERIC(12,2);
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_title TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS paddle_started_at TIMESTAMPTZ;
  `);
}
