# FlüsterLos

Open-source, self-hosted **silent auction** for charity and event hosts.

> QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE)
**Status:** host dashboard + guest bid PWA + vouchers / invoices / PromptPay
**Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## Why
Closed SaaS silent-auction tools lock you into fees, vendor data, and suite bloat. FlüsterLos is Docker-first OSS you run yourself.

## MVP (locked)
- Host dashboard: list of auctions, signed-in email in the top bar, create event, reopen past events
- Scheduled start/end (auto open/close + countdowns) in the **event time zone** (default Asia/Bangkok, `DEFAULT_EVENT_TIMEZONE`); host can close now, extend, reopen (while nothing is paid) and edit times and items
- Per-auction **currency:** USD, EUR, or THB
- Installable PWA + QR join
- Guest identity is the **mobile number** (E.164; numbers without `+` are read as `DEFAULT_PHONE_COUNTRY`, default Thailand). Name optional, shown on the board (defaults to `Guest …1234`); email optional, only needed for voucher PDFs
- Guest bid UI: auction title + time left + one-tap bid (no product chrome)
- Item **photo file upload** (not a URL); item type **voucher** (PDF emailed after payment, can be attached later) or **physical** (collected at the desk)
- **Sponsors:** name + logo per item, shown on the bid page, big screen and invoice; sponsors are reused by name
- Live mobile bidding; **live stats visible to everyone**
- Big-screen engager view for the event room
- Single `docker compose up`
- Host auth: first registered host is owner (email + bcrypt password, httpOnly session cookie); one-time `BOOTSTRAP_TOKEN` gates that first registration
- **Users:** guests are keyed by phone, extra hosts by email; owner can add/remove host logins
- **Vouchers + invoices:** one invoice per winning guest (sum of all wins); Thai PromptPay QR (amount filled for THB); payslip upload; host confirms → SMTP emails voucher PDF(s) (one attachment per won item). **No card/Stripe checkout.**
- **Payment desk:** mark each invoice paid by cash / bank transfer / PromptPay, tick each item when it is handed over, see paid/handed-over totals on the event card, export results as Excel or CSV

## Quickstart

### A) Build from source

1. Copy env: `cp .env.example .env` and set a strong `BOOTSTRAP_TOKEN` (used only for the first owner register)
2. Optionally set `SMTP_*` so voucher emails (and login codes) go out by email. Set `DEFAULT_PHONE_COUNTRY` if your guests are not in Thailand
3. Start stack: `docker compose up --build`
4. Open **Host UI** at http://localhost:8080/host
   - **Fresh install:** register with email, password, and `BOOTSTRAP_TOKEN` from `.env`
   - **Later visits:** log in with email + password
5. Configure **Payment settings** (PromptPay ID and/or upload a static QR image)
6. Create event: title, schedule, **currency** (USD / EUR / THB)
7. Add items — type **voucher** (voucher PDF now or later) or **physical**; optional **photo file** and **sponsor name + logo** (stored under `DATA_DIR`, volume `appdata:/data`)
8. Guest joins at `/e/<code>` with their **mobile number** (name and email optional), bids at `/e/<code>/bid`
9. After close, winners open `/e/<code>/invoice` — combined total, PromptPay QR, payslip upload; winners of vouchers without an email on file are asked for one
10. At the **Payment desk** the host picks the method (cash / bank transfer / PromptPay) and clicks **Mark paid** → voucher PDF(s) are emailed, physical items get a "collect at the desk" note. Tick **Handed over** per item as prizes leave the desk
11. Event card shows paid / handed-over totals and links to the **Excel / CSV results export** (lot, sponsor, winner, phone, amount, paid, method, handed over)
12. **Users** on Host: list/add auction guests by phone; owner can add extra host logins by email

API also on http://localhost:3000 (`/api/health`).

### Development & tests
```bash
npm ci
npm run typecheck
# API tests need a Postgres database they can wipe:
TEST_DATABASE_URL=postgres://fluesterlos:fluesterlos@localhost:5432/fluesterlos_test npm test
```
CI workflow (`ci/github-ci.yml`, to be moved to `.github/workflows/ci.yml`) runs typecheck, tests (Postgres service container) and the web build on every pull request.

### B) Prebuilt GHCR images

After images are published to GitHub Container Registry (Actions workflow on `main`):

```bash
cp .env.example .env   # set BOOTSTRAP_TOKEN (+ SMTP_* if needed)
docker compose -f docker-compose.ghcr.yml up
```

Pulls `ghcr.io/bandulix/fluesterlos-api:latest` and `ghcr.io/bandulix/fluesterlos-web:latest` (no local build). Optional pin: `FLUESTERLOS_TAG=<sha>`. If packages are private, `docker login ghcr.io` with a PAT that has `read:packages`.

### Host vs guest auth
- **Hosts** use email + password (bcrypt). Session is an httpOnly `fl_host_session` cookie. Owner may add more host logins by email.
- **Guests** are keyed by **mobile number** per auction (same number = same guest). Name is optional display on the board; the full number is never shown publicly. Email is optional and may be shared (e.g. by a couple).
- If a number is already bidding on another device, the new device must enter a **6-digit code**. It is emailed to the address on file (if the guest gave one and SMTP is set) and always shown on the host **Help desk** card, so a host can check who it is and read it out. When it cannot be emailed it is also written to the API log as a last resort. Codes are valid 10 min, max 5 tries.
- **Upgrading from 0.2.x:** the migration keeps existing email-keyed guests; their devices keep working, and the phone is attached the next time they join from that device (or when a host adds the same email with a phone).
- **CORS / proxy:** credentialed CORS is limited to the origin of `PUBLIC_URL` (override with `CORS_ORIGINS`). Rate limits on join, verify, bid and host login are set with `RATE_LIMIT_*` (see `.env.example`).

### Payment / vouchers / SMTP
- **Invoice model:** exactly **one invoice per winning guest** = sum of all their winning bids (not one invoice per item). Itemized lines are detail under that invoice.
- **PromptPay:** set phone or 13-digit national ID in Host → Payment settings. Guests get an EMV PromptPay QR; **amount is filled only when the auction currency is THB**. Optionally upload a static QR image instead/in addition.
- **Payslip:** guest pays outside the app, uploads image/PDF in the invoice PWA view.
- **Confirm:** host marks payment received once for the whole invoice with the method. Cash needs no payslip; bank transfer / PromptPay need a payslip or the host's explicit "I checked the transfer arrived". The server then emails **one PDF attachment per won voucher** and a "collect at the desk" line per physical item. If a voucher PDF is still missing the email is held; attach the PDF on the item and press **Send email**.
- **Handover:** per item, only after the invoice is paid (timestamp + host recorded).
- **Results export:** `GET /api/host/events/:code/results.xlsx` or `.csv` (host only), one row per lot including unsold lots.
- **Env:** `DATA_DIR=/data`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (see `.env.example`). Compose mounts volume `appdata` at `/data` on the API.

### Break-glass (owner locked out)
```bash
docker compose exec db psql -U fluesterlos -d fluesterlos -c \
  "DELETE FROM host_sessions; DELETE FROM host_users;"
```
Then register again at `/host` with the current `BOOTSTRAP_TOKEN`.

## Stack
- API: Node.js + Fastify + Postgres + SSE + multipart + nodemailer
- Web: Vite + React + TypeScript PWA
- Compose: `api` + `web` (nginx) + `db` (postgres:16) + `appdata` volume
- Optional: prebuilt images via GHCR + `docker-compose.ghcr.yml`

## Out of MVP
Gala suite, native store apps, card checkout, multi-tenant SaaS, CRM, AI copy. Extra host *roles* beyond owner vs host later.

## Theming

Restyle with **CSS only** — no React edits required.

1. **Default:** [`web/public/theme.css`](web/public/theme.css) — CSS variables on `:root` / `[data-theme="gala"]`, engager motion, bid flash.
2. **Overrides:** edit or replace [`web/public/custom.css`](web/public/custom.css) (loaded **after** `theme.css` in `web/index.html`).
3. **Variants:** `data-theme="gala"` (default on `<html>`) or `data-theme="calm"` for a quieter host-friendly palette.

Docker mount example:

```yaml
services:
  web:
    volumes:
      - ./my-brand.css:/usr/share/nginx/html/custom.css:ro
```

```css
/* my-brand.css */
:root {
  --accent: #ff6b9d;
  --accent-2: #c084fc;
  --bg: #0a0a12;
}
```

Animations respect `prefers-reduced-motion: reduce`.

## Docs
- [`CHANGELOG.md`](./CHANGELOG.md)
- [`docs/mvp-one-pager.md`](./docs/mvp-one-pager.md)

## Name
*Flüster* (whisper) + *Los* (auction lot). ASCII: **FluesterLos** / `fluesterlos`.
