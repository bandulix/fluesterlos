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
- Scheduled start/end (auto open/close + countdowns)
- Per-auction **currency:** USD, EUR, or THB
- Installable PWA + QR join
- Guest identity is **email** (name optional, shown on the board; no phone OTP)
- Guest bid UI: auction title + time left + one-tap bid (no product chrome)
- Item **photo file upload** (not a URL) + required voucher PDF
- Live mobile bidding; **live stats visible to everyone**
- Big-screen engager view for the event room
- Single `docker compose up`
- Host auth: first registered host is owner (email + bcrypt password, httpOnly session cookie); one-time `BOOTSTRAP_TOKEN` gates that first registration
- **Users:** guests and extra hosts are keyed by email; owner can add/remove host logins
- **Vouchers + invoices:** one invoice per winning guest (sum of all wins); Thai PromptPay QR (amount filled for THB); payslip upload; host confirms → SMTP emails voucher PDF(s) (one attachment per won item). **No card/Stripe checkout.**

## Quickstart

### A) Build from source

1. Copy env: `cp .env.example .env` and set a strong `BOOTSTRAP_TOKEN` (used only for the first owner register)
2. Optionally set `SMTP_*` so voucher emails work after payment confirm
3. Start stack: `docker compose up --build`
4. Open **Host UI** at http://localhost:8080/host
   - **Fresh install:** register with email, password, and `BOOTSTRAP_TOKEN` from `.env`
   - **Later visits:** log in with email + password
5. Configure **Payment settings** (PromptPay ID and/or upload a static QR image)
6. Create event: title, schedule, **currency** (USD / EUR / THB)
7. Add items — each item needs a **voucher PDF**; optional **photo file** (stored under `DATA_DIR`, volume `appdata:/data`)
8. Guest joins at `/e/<code>` with **email** (name optional), bids at `/e/<code>/bid`
9. After close, winners open `/e/<code>/invoice` — combined total, PromptPay QR, payslip upload
10. Host reviews payslips on the event card and clicks **Payment correct & received** → guest gets voucher PDF(s) by email
11. **Users** on Host: list/add auction guests by email; owner can add extra host logins by email

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
- **Guests** are keyed by **email** per auction (same email = same guest). Name is optional display on the board.
- If an email is already bidding on another device, the new device must enter a **6-digit code** sent to that email (SMTP). Without SMTP the code appears in the API log (`docker compose logs api`), so a host can read it out at the help desk.
- **CORS / proxy:** credentialed CORS is limited to the origin of `PUBLIC_URL` (override with `CORS_ORIGINS`). Rate limits on join, verify, bid and host login are set with `RATE_LIMIT_*` (see `.env.example`).

### Payment / vouchers / SMTP
- **Invoice model:** exactly **one invoice per winning guest** = sum of all their winning bids (not one invoice per item). Itemized lines are detail under that invoice.
- **PromptPay:** set phone or 13-digit national ID in Host → Payment settings. Guests get an EMV PromptPay QR; **amount is filled only when the auction currency is THB**. Optionally upload a static QR image instead/in addition.
- **Payslip:** guest pays outside the app, uploads image/PDF in the invoice PWA view.
- **Confirm:** host marks payment received once for the whole invoice; server emails **multiple PDF attachments** (one per won item) via SMTP.
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
