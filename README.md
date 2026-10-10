# FlüsterLos

Open-source, self-hosted **silent auction** for charity events. Guests scan a QR code, type their phone number and bid from their own phone. The host runs the payment desk from a browser, and a big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md) · **Stack:** Fastify + Postgres API, Vite + React PWA, Docker Compose

<p>
  <img src="docs/screenshots/guest-01-join.png" width="200" alt="Join: phone number and Start bidding">
  <img src="docs/screenshots/guest-03-bid-page.png" width="200" alt="Bid page: item card with one-tap bid">
  <img src="docs/screenshots/guest-05-outbid.png" width="200" alt="Outbid banner and status">
  <img src="docs/screenshots/guest-10-invoice.png" width="200" alt="Invoice with PromptPay QR and payslip upload">
</p>

---

## What it is, and who it's for

FlüsterLos grew out of a charity gala that ran its silent auction on paper bid sheets plus an Excel workbook. Collecting the sheets, finding the winners, chasing payments and handing out vouchers all happened by hand. FlüsterLos replaces that with:

- **Guests** bid on their phones. There is no app store, no account and no password.
- **Hosts** (the organising team) create the event and items, watch the bidding, collect payments and hand over prizes.
- **The room** watches a big-screen view with live totals and recent bids.

It is aimed at small and medium charity events (Rotary/Lions clubs, school galas, NGO dinners) that want to run it themselves. It is built Thailand-first (PromptPay, `Asia/Bangkok`, Thai phone numbers) but works with USD and EUR and any time zone.

## Guest flow

| | |
|---|---|
| <img src="docs/screenshots/guest-01-join.png" width="220" alt="Join screen"> | **1. Scan → phone → bid.** The QR opens `/e/<code>`. The only screen asks for a **mobile number**: big field, numeric keypad, auto-formatted while typing (Thai default, e.g. `081 234 5678`; `+…` for other countries). One tap on **Start bidding** opens the items. No name, email or sign-up is asked here. |
| <img src="docs/screenshots/guest-03-bid-page.png" width="220" alt="Bid page"> | **2. Bid.** Each item is a card with photo, sponsor logo, current bid and a big one-tap **Bid ฿X** for the next valid amount. A −/+ stepper lets guests bid more, and there is **Buy now** where the host set one. The countdown follows the server clock. Updates are live (SSE). Each bid is confirmed with a short toast; there are no dialogs. |
| <img src="docs/screenshots/guest-05-outbid.png" width="220" alt="Outbid"> | **3. Winning / outbid.** Every item a guest bid on shows **✓ You're winning** (green) or **↑ Outbid** (red). When a guest is outbid, a banner appears with a one-tap re-bid, and the phone vibrates where supported. Filter chips: **All / My bids / Winning / Outbid**. After the first bid a small, dismissible card offers **"Show your name on the board?"**. Until then the board shows `Guest …1234`, never the full number. |
| <img src="docs/screenshots/guest-08-new-device-code.png" width="220" alt="Code step"> | **4. A code only when it's really needed.** If the number is already bidding on *another* phone, the new phone asks for a 6-digit code. The code is emailed if the guest has an email on file and SMTP is set; otherwise the host reads it off the **Help desk** card. Logging in again on the *same* phone, even after "Not you?", happens silently. |
| <img src="docs/screenshots/guest-09-closed.png" width="220" alt="Closed"> | **5. Closed.** The page switches at the closing second: **"You won 2 items — Pay now"**. |
| <img src="docs/screenshots/guest-10-invoice.png" width="220" alt="Invoice"> | **6. Pay.** One screen with the total and a large **PromptPay QR**. The amount is filled in for THB. **Save QR** opens the share sheet or downloads the image, and a long-press on the QR saves it too (useful in LINE). The guest can **upload a payslip** (camera or gallery); it uploads as soon as it's picked. **Email is asked only here, and only if they won a voucher** (prefilled if known). Physical prizes say "collect at the desk". |

More details:

- **Add to home screen:** a non-blocking hint shows only after the first bid and never on the join screen. iOS gets Share → "Add to Home Screen" instructions; Android gets an install button when the browser offers one. It is never shown inside LINE or other in-app browsers, and dismissing it is permanent.
- **Accessibility:** tap targets are at least 48 px, inputs use 16 px+ text (no iOS zoom), labels are accessible, focus rings are visible and `prefers-reduced-motion` is respected.
- **Strings:** all guest text lives in a string table ([`web/src/i18n/en.ts`](web/src/i18n/en.ts)). Thai or German can be added as another table; only English ships today.

## Host flow

Open **`/host`**.

1. **Register the owner.** The first registration needs the one-time `BOOTSTRAP_TOKEN` from your env; after that, registration is closed. Hosts sign in with email + password (bcrypt, httpOnly session cookie). The owner can add and remove more host logins by email.
2. **Payment settings:** a PromptPay ID (phone or 13-digit national ID) and payee name, and/or an uploaded static QR image.
3. **Create an event:** title, currency (USD / EUR / THB) and **time zone** (default `DEFAULT_EVENT_TIMEZONE`). Start/end are entered and shown in the event's zone, whatever zone the host's device is in. Start defaults to now and end to +2 h. Each item has:
   - title, description, starting bid, increment, optional buy-now
   - optional **photo** (uploaded file)
   - type **voucher** (PDF emailed after payment; the PDF can be attached later) or **physical** (collected at the desk)
   - optional **sponsor** name + logo. Sponsors are reused by name, and a sponsor typed for an earlier item is suggested for later ones.
4. **Event card:** join QR + link, links to Stats and the big screen, and live totals (paid / handed over). Host controls:
   - **close now**
   - **extend** (up to 24 h at a time). On a closed event this **reopens** it, as long as nothing has been paid.
   - **edit times**
   - **edit / delete items**
5. **Users:** list guests, or add them in advance by phone; such a guest's first join needs no code. Extra host logins are managed here too.
6. **Help desk:** shows pending 6-digit login codes, so a host can check who someone is and read the code out.
7. **Payment desk** (after close): one invoice per winning guest, totalling all their wins.
   - Mark paid by **cash / bank transfer / PromptPay**. Transfers without a payslip need an explicit "I checked the transfer arrived".
   - Marking paid emails the voucher PDFs (one attachment per won voucher). If a voucher PDF is missing, the desk warns ("voucher PDF missing") and holds the email until the PDF is attached; then press **Send email**.
   - Tick **Handed over** per item (only after payment; time and host are recorded). A toast confirms it.
8. **Export:** `results.xlsx` / `results.csv` with one row per lot, including unsold ones. Columns: lot, item, type, sponsor, winner, phone, email, amount, currency, paid, method, paid at, handed over, handed over at.
   - Timestamps are in the event's time zone, which is named in the header.
   - CSV phones are readable without a leading `+` (`081 234 5678` for the default country, `(+49) 1512 3456789` otherwise), so spreadsheets don't treat them as formulas.
   - xlsx keeps E.164 as text.

## Big screen

- **`/e/<code>/engager`:** full-screen room display with total raised, a highlighted item, a recent-bids feed, a sponsor strip and the join link. It is live and animated (gala theme).
- **`/e/<code>/stats`:** a simpler public stats page.

## Quickstart

### A) Build from source (Docker Compose)

```bash
cp .env.example .env        # set a strong BOOTSTRAP_TOKEN; optionally SMTP_* and DEFAULT_PHONE_COUNTRY
docker compose up --build
```

- Web (guest + host UI): http://localhost:8080. The host UI is at `/host`.
- API: http://localhost:3000 (`/api/health`). The web container proxies `/api/` to it.
- Data: Postgres in volume `pgdata`; uploads (photos, logos, voucher PDFs, payslips, host QR) in volume `appdata` (`/data`).

For production, put it behind HTTPS and set `PUBLIC_URL` to the public origin. `PUBLIC_URL` is used in join links and QR codes, and https makes cookies `Secure`.

### B) Prebuilt images (GHCR)

`docker-compose.ghcr.yml` uses `ghcr.io/bandulix/fluesterlos-api` and `ghcr.io/bandulix/fluesterlos-web` (tag `FLUESTERLOS_TAG`, default `latest`) instead of building locally:

```bash
cp .env.example .env
docker compose -f docker-compose.ghcr.yml up
```

This only works once images have been published. The repository currently contains no publish workflow, so build them yourself or use option A. For private packages, `docker login ghcr.io` with a token that has `read:packages`.

## Configuration

API environment variables (see [`.env.example`](./.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (compose sets it) | Postgres connection string. |
| `BOOTSTRAP_TOKEN` | `change-me-once` (compose) | One-time secret for registering the first owner. **Change it before first boot.** |
| `PORT` | `3000` | API port. |
| `PUBLIC_URL` | `http://localhost:8080` | Public web origin: join URLs/QR, CORS default, `Secure` cookies when https. |
| `CORS_ORIGINS` | origin of `PUBLIC_URL` | Comma-separated browser origins allowed for credentialed CORS (e.g. `http://localhost:5173` for Vite dev). |
| `TRUST_PROXY` | `loopback,linklocal,uniquelocal` | Proxy hops trusted for `X-Forwarded-For` (client IP for rate limits). |
| `DEFAULT_PHONE_COUNTRY` | `TH` | Country for numbers typed without `+` (ISO 3166 alpha-2). |
| `DEFAULT_EVENT_TIMEZONE` | `Asia/Bangkok` | Default IANA zone for new events. Times are stored in UTC. |
| `DATA_DIR` | `/data` | Upload storage (mount a volume). |
| `SMTP_HOST`, `SMTP_PORT` (`587`), `SMTP_SECURE` (`false`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | empty | Voucher emails and guest login codes. Without SMTP, codes appear on the Help desk card and in the API log, and voucher emails are not sent. |
| `RATE_LIMIT_JOIN_PER_MIN` | `10` | Joins per IP + phone. |
| `RATE_LIMIT_VERIFY_PER_10MIN` | `10` | Code checks per IP + phone (plus max 5 tries per code). |
| `RATE_LIMIT_BID_PER_10S` | `20` | Bids per guest. |
| `RATE_LIMIT_LOGIN_PER_MIN` | `10` | Host logins per IP + email. |
| `PROMPTPAY_ID`, `PROMPTPAY_PAYEE_NAME` | empty | Fallback when nothing is saved in Host → Payment settings. |

Web build argument: `VITE_API_URL` (default empty = same origin, served via the `/api/` proxy).

> `docker-compose.yml` forwards the variables above except `RATE_LIMIT_*` and `PROMPTPAY_*`. To use those, add them under `api.environment`.

## Updates and offline caching (PWA)

- The web app is a PWA (vite-plugin-pwa / Workbox). App files are precached; `/api/` is never served from the app shell, so exports and PDFs always reach the API.
- **Updates are picked up reliably:**
  - `index.html`, routes, `sw.js`, the Workbox runtime and the manifest are sent with `Cache-Control: no-cache`; hashed `/assets/*` are cached forever (`immutable`). See [`web/nginx.conf`](web/nginx.conf); `vite preview` does the same.
  - The app checks for a new version every 10 min and whenever the tab comes back into view, and **reloads itself** when one takes over. If someone is typing, the reload waits until the input is gone. Guests never get a prompt; host pages show a small "Update available" banner.
- **Guests don't download host code:** host pages are lazy-loaded and not precached.

## Security notes

- **Guest identity = phone number per event.** The full number is never shown publicly; the board shows a chosen name or `Guest …1234`.
- **New device → code:** a code is required when a number is already used on another phone. Codes are 6 digits, valid 10 minutes, at most 5 tries, and one can be re-sent after 60 s.
- **Device trust (trade-off):** after a successful sign-in, the phone gets a long-lived httpOnly device cookie. The server stores only a hash, per guest. Re-login on that phone is silent, **including after "Not you?"**. So someone else using *that same phone* could sign in with the previous guest's number without a code. Another phone always needs a code, and a code request alone never makes a device trusted.
- **Hosts:** bcrypt passwords, httpOnly `fl_host_session` cookie, and registration closed after the first owner (`BOOTSTRAP_TOKEN`).
- **Rate limits** on join, code check, bids and host login (see the table). Credentialed CORS is limited to `PUBLIC_URL` / `CORS_ORIGINS`.
- **Payments happen outside the app** (PromptPay, transfer, cash). There is no card processing.
- **Spreadsheet safety:** exported cells starting with `= + - @` are neutralised.

## Theming

Restyle with **CSS only**:

1. [`web/public/theme.css`](web/public/theme.css) holds the defaults: CSS variables on `:root` / `[data-theme="gala"]`, plus animations for the big screen and bids.
2. [`web/public/custom.css`](web/public/custom.css) is loaded after it; override variables there. Guest-specific tokens such as `--g-win`, `--g-lose` and `--g-radius` can be overridden too.
3. `data-theme="calm"` on `<html>` gives a quieter palette.

```yaml
services:
  web:
    volumes:
      - ./my-brand.css:/usr/share/nginx/html/custom.css:ro
```

```css
:root { --accent: #ff6b9d; --accent-2: #c084fc; --bg: #0a0a12; }
```

## Backups and break-glass

There is no built-in backup feature; back up the two volumes yourself:

```bash
# database
docker compose exec -T db pg_dump -U fluesterlos -d fluesterlos > fluesterlos-$(date +%F).sql
# uploads (photos, logos, voucher PDFs, payslips, host QR)
docker run --rm -v "$(basename "$PWD")_appdata:/data" -v "$PWD:/backup" alpine tar czf /backup/appdata-$(date +%F).tgz -C /data .
```

(The volume name depends on the compose project name; check it with `docker volume ls`.)

**Owner locked out?** Remove host logins and sessions, then register again at `/host` with the current `BOOTSTRAP_TOKEN`:

```bash
docker compose exec db psql -U fluesterlos -d fluesterlos -c "DELETE FROM host_sessions; DELETE FROM host_users;"
```

## Development

```bash
npm ci
npm run typecheck                 # api + web
# API tests need a Postgres database they may wipe:
TEST_DATABASE_URL=postgres://fluesterlos:fluesterlos@localhost:5432/fluesterlos_test npm test
npm run build -w web
npm run dev -w web                # Vite dev server on :5173; proxies /api to API_PROXY_TARGET (default http://localhost:3000)
```

- API tests use Vitest with `fastify.inject` against a real Postgres. Web tests (Vitest) cover the logic: phone formatting, bid amounts and status, filters, the install hint, cache headers and the update/reload decision.
- **CI:** the workflow lives at [`ci/github-ci.yml`](ci/github-ci.yml) (typecheck, tests with a Postgres service, web build). To activate it, move it to `.github/workflows/ci.yml`. That push needs a token with the `workflow` scope.
- Layout: `api/` (Fastify, `src/`, `test/`), `web/` (Vite app, `src/pages`, `src/guest`, `src/i18n`, `public/theme.css`), `docs/`.

## Out of scope / roadmap

**Not planned:** card or Stripe checkout, native store apps, multi-tenant SaaS, CRM, AI copywriting, full gala-management suite.

**Possible next steps:**
- Thai/German string tables (the structure is ready)
- host roles beyond owner vs. host
- a published-image workflow for GHCR

## Docs

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/mvp-one-pager.md](./docs/mvp-one-pager.md)
- Guest screenshots: [docs/screenshots/](./docs/screenshots/)

## Name

*Flüster* (whisper) + *Los* (auction lot). ASCII: **FluesterLos** / `fluesterlos`.
