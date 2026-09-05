# FlüsterLos

Open-source, self-hosted **silent auction** for charity and event hosts.

> QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE)
**Status:** first vertical slice — create event, QR join, bid, live stats, engager + host bootstrap auth

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

## Quickstart

1. Copy env: `cp .env.example .env` and set a strong `BOOTSTRAP_TOKEN` (used only for the first owner register)
2. Start stack: `docker compose up --build`
3. Open **Host UI** at http://localhost:8080/host
   - **Fresh install:** register with email, password, and `BOOTSTRAP_TOKEN` from `.env` — that account becomes the owner
   - **Later visits:** log in with email + password (open registration is blocked once an owner exists)
4. Create event + items, share QR / join link
5. Guest joins at `/e/<code>` (name + email only), then bids at `/e/<code>/bid`
6. Public stats: `/e/<code>/stats` — Engager big screen: `/e/<code>/engager`

API also on http://localhost:3000 (`/api/health`).

### Host vs guest auth
- **Hosts** use email + password (bcrypt). Session is an httpOnly `fl_host_session` cookie (not localStorage / Bearer). Guests stay name+email only and are a separate model — do not reuse guest rows for hosts.
- Shared `HOST_TOKEN` pasting in the Host UI is removed.

### Break-glass (owner locked out)
To re-open first-owner bootstrap (destroys host accounts/sessions):

```bash
docker compose exec db psql -U fluesterlos -d fluesterlos -c \
  "DELETE FROM host_sessions; DELETE FROM host_users;"
```

Then register again at `/host` with the current `BOOTSTRAP_TOKEN`. (Alternatively update `password_hash` in `host_users` with a new bcrypt hash if you only need a password reset.)

## Stack (this slice)
- API: Node.js + Fastify + Postgres + SSE
- Web: Vite + React + TypeScript PWA
- Compose: `api` + `web` (nginx) + `db` (postgres:16)

## Out of MVP
Gala suite (ticketing / tables / Fund-a-Need), native store apps, card checkout, multi-tenant SaaS, CRM, AI copy. Inviting additional hosts/roles is stubbed for later (owner-only today).



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
