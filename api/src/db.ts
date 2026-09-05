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
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, email)
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

    CREATE INDEX IF NOT EXISTS bids_item_created_idx ON bids(item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS items_event_sort_idx ON items(event_id, sort_order);
    CREATE INDEX IF NOT EXISTS host_sessions_user_idx ON host_sessions(host_user_id);
    CREATE INDEX IF NOT EXISTS host_sessions_expires_idx ON host_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS invoices_event_idx ON invoices(event_id);
  `);
}
