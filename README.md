# FlüsterLos

Open-source, self-hosted **silent auction** for charity and event hosts.

> QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE)
**Status:** vertical slice + vouchers / per-guest invoices / PromptPay payslip flow

## Why
Closed SaaS silent-auction tools lock you into fees, vendor data, and suite bloat. FlüsterLos is Docker-first OSS you run yourself.

## MVP (locked)
- Host setup with scheduled start/end (auto open/close + countdowns)
- Installable PWA + QR join
- Guest registration: **name + email only** (no phone OTP)
- Live mobile bidding
- **Live stats visible to everyone** (not host-only)
- Big-screen engager view for the event room
- Single `docker compose up`
- Host auth: first registered host is owner (email + bcrypt password, httpOnly session cookie); one-time `BOOTSTRAP_TOKEN` gates that first registration
- **Vouchers + invoices:** one invoice per winning guest (sum of all wins); Thai PromptPay QR; payslip upload; host confirms → SMTP emails voucher PDF(s) (one attachment per won item). **No card/Stripe checkout.**

## Quickstart

1. Copy env: `cp .env.example .env` and set a strong `BOOTSTRAP_TOKEN` (used only for the first owner register)
2. Optionally set `SMTP_*` so voucher emails work after payment confirm
3. Start stack: `docker compose up --build`
4. Open **Host UI** at http://localhost:8080/host
   - **Fresh install:** register with email, password, and `BOOTSTRAP_TOKEN` from `.env`
   - **Later visits:** log in with email + password
5. Configure **Payment settings** (PromptPay ID and/or upload a static QR image)
6. Create event, then **add items** — each item requires a voucher PDF (stored under `DATA_DIR`, volume `appdata:/data`)
7. Guest joins at `/e/<code>`, bids at `/e/<code>/bid`
8. After close, winners open `/e/<code>/invoice` — combined total, Thai QR, payslip upload
9. Host reviews payslips on the event card and clicks **Payment correct & received** → guest gets voucher PDF(s) by email

API also on http://localhost:3000 (`/api/health`).

### Host vs guest auth
- **Hosts** use email + password (bcrypt). Session is an httpOnly `fl_host_session` cookie. Guests stay name+email only.

### Payment / vouchers / SMTP
- **Invoice model:** exactly **one invoice per winning guest** = sum of all their winning bids (not one invoice per item). Itemized lines are detail under that invoice.
- **PromptPay:** set phone or 13-digit national ID in Host → Payment settings. Guests get an EMV PromptPay QR (amount filled). Optionally upload a static QR image instead/in addition.
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

## Out of MVP
Gala suite, native store apps, card checkout, multi-tenant SaaS, CRM, AI copy. Extra host roles later (owner-only today).

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
See [`docs/mvp-one-pager.md`](./docs/mvp-one-pager.md).

## Name
*Flüster* (whisper) + *Los* (auction lot). ASCII: **FluesterLos** / `fluesterlos`.
