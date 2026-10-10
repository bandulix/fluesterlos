# Changelog

All notable changes to FlüsterLos are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project versions toward [SemVer](https://semver.org/).

## [Unreleased]

### Fixed — browser click test, round 1
- **Time zones (critical):** the create form pre-filled start/end with UTC clock times shown as local times, so a host whose browser was not on UTC got an event that was already closed. Events now have a **time zone** (default `Asia/Bangkok`, `DEFAULT_EVENT_TIMEZONE`, selectable per event). Start/end are entered and shown in that zone (with "UTC+7" label and the device's local time when it differs); the browser sends ISO times **with offset** and the API rejects times without one. Times are stored in UTC. Help desk, payment desk and countdowns use the event zone too. The create form refuses an end time in the past.
- **Exports / file links (critical):** the PWA service worker answered navigations to `/api/...` with the app shell, so Excel/CSV exports, "View payslip" and voucher PDF links showed a blank app page. `/api/` is now excluded from the navigation fallback, and the new service worker takes over existing installs immediately (`skipWaiting`, `clientsClaim`, old caches cleaned up).
- **PWA manifest:** valid `start_url`, `scope`, `id` and PNG icons (192/512 + maskable); the per-event guest manifest (served from a `blob:` URL) now uses absolute URLs. Added `favicon.ico`.
- New-event form resets after a successful create (title, times, items, chosen files, sponsor + logo) and can't be submitted twice. The sponsor logo input is no longer disabled.
- Guest bid page shows per item **"You're winning" / "Outbid"** (live, via an opaque leader key — no guest ids in the public payload) instead of a stale "You're in at …" banner, and who is bidding ("Bidding as Anna (…1234)") with **Not you? Log out** (`POST /api/events/:code/logout`).
- Engager sponsor strip shows logo + name for every sponsor (name chip when there is no logo).
- Payment desk: after "Mark paid" for a guest without email it says what to hand over at the desk (vouchers to print/show, physical items); voucher PDF links per line (`GET /api/host/events/:code/items/:itemId/voucher`); "Send email" only when the guest has an email; attaching a voucher PDF refreshes the invoices; "View payslip" styled like the other buttons; the handover checkbox updates immediately (optimistic, per-row saving) instead of disabling the whole desk.
- Guest invoice page shows the saved voucher email with a **Change** option.
- Replaced sponsor logos / item photos are not hidden by browser caches (versioned URLs).

### Added — host event controls
- Event card shows start/end in the event zone and **why** it is closed (scheduled end passed, or "closed early at … by …").
- **Close now**, **Extend by N minutes**, **Reopen for N minutes** (`POST /api/host/events/:code/close`, `/extend {minutes}`), **edit start/end/time zone/currency** (`PATCH /api/host/events/:code`, `PUT /api/host/events/:code/schedule`). A closed auction can only be reopened while **no invoice is paid**; the start can't move into the future once there are bids. Bids take a share lock on the event row, so nothing is accepted after "Close now".
- **Edit / delete items** and **add items** to an existing event (`PATCH` / `DELETE /api/host/events/:code/items/:itemId`). Prices and type lock once an item has bids or the auction is closed; title, description, sponsor and photo stay editable; items with bids can't be deleted. Switching a voucher item to physical drops its PDF.
- Sponsor field suggests existing sponsors (with their logos) and shows the logo on file for a matching name.
- Web unit tests (Vitest): time zone helpers under several device zones, service worker / manifest config. `npm test` runs API and web tests.

### Added — event essentials (stacks on the pre-event fixes)
- **Physical prizes:** items have a type `voucher` or `physical`. Voucher PDFs are optional at creation and can be attached later (`POST /api/host/events/:code/items/:itemId/voucher`); physical items reject a PDF. Winner emails handle mixed wins: one PDF per voucher, plus "please collect at the desk" for physical items. The bid page and invoice show the type.
- **Phone is the guest key:** guests join with a mobile number (normalized to E.164 via `libphonenumber-js`; `DEFAULT_PHONE_COUNTRY`, default `TH`). Name optional (board shows `Guest …1234` if empty), email optional. Winners of vouchers without an email are asked for one on the invoice page (`PUT /api/events/:code/me/email`).
- **Login codes for a number already in use:** sent to the guest's email on file when possible, and always listed on the new host **Help desk** card (`GET /api/host/events/:code/login-requests`); still logged on the server as a fallback. An email typed on the new device is never used for delivery.
- **Payment desk:** mark paid with method cash / bank transfer / PromptPay (non-cash without payslip requires the host's explicit confirmation), per-item **handed over** checkbox with timestamp and host, **Send email** to (re)send winner emails, guest search. The event card shows paid / collected / handed-over totals.
- **Results export:** Excel (`.xlsx`, via `exceljs`) and CSV (UTF-8 BOM, formula-injection safe) with lot, item, type, sponsor, winner, phone, email, amount, paid, method, handed over.
- **Sponsors:** name + logo (image) per item, reused across items/events by name (`GET/POST /api/host/sponsors`, public `GET /api/sponsors/:id/logo`). Shown on the bid page, the big-screen engager (featured item + sponsor strip) and the invoice.
- Tests for all of the above, including an upgrade test from a v0.2.0 database.

### Changed
- Guests are identified by phone instead of email. **Migration** (idempotent): adds `guests.phone` (unique per event when set), drops the per-event email uniqueness (a couple can share an email) and keeps existing email-keyed guests working with their current device tokens. Join/verify bodies are now `{ phone, name?, email? }` / `{ phone, code }`; host add-guest is `{ phone, name?, email? }`.
- `confirm-payment` takes `{ method, confirmedWithoutSlip }` and no longer fails with 503 when SMTP is missing; it returns an `emailStatus` instead (`sent`, `no_email`, `smtp_not_configured`, `voucher_pdf_missing`, …).
- Rate limits for join/verify are keyed per IP + phone.

### Security
- **Guest impersonation fixed:** joining with an email that is already bidding no longer returns that guest's token. On a new device the guest gets a **6-digit code by email** (`POST /api/events/:code/join/verify`; valid 10 min, max 5 tries, one resend per 60 s). Without SMTP the code is written to the API log. Host-added guests that never joined can still join once without a code. Guest display names can no longer be changed by someone else re-joining with the email.
- **Rate limits** (`@fastify/rate-limit`) on guest join and verify (per IP + email), bids (per guest), and host login. Limits can be tuned with `RATE_LIMIT_*` env vars.
- **CORS restricted:** only the origin of `PUBLIC_URL` by default, or `CORS_ORIGINS` (comma-separated). The SSE stream no longer reflects arbitrary origins. `TRUST_PROXY` controls which proxy hops are trusted for client IPs.
- Guest cookie gets `Secure` when `PUBLIC_URL` is https.

### Fixed
- **Invoices only after the auction closes.** Guests see no invoice and cannot upload payslips while the auction is open. Hosts cannot confirm payment before close. Invoices are built from the final winners only, and stale unpaid invoices of guests who no longer win are removed. Invoice generation is serialized per event (safe when many winners open their invoice at once).
- **Buy-now ends the item:** after a buy-now no more bids are accepted (`409`). Buy-now is never accepted at or below the current high bid. An amount above the buy-now price is recorded at the buy-now price. `buyNow` must be greater than `startingBid`. The bid page shows "Sold (buy now)" and hides buttons that can't win.
- Equal top bids (only possible in old data) go to the earliest bidder, the same on the board and on invoices.

### Added
- API test suite (Vitest + `fastify.inject` against real Postgres), CI workflow running typecheck, tests and the web build on every PR (`ci/github-ci.yml`; move to `.github/workflows/` to enable).
- `package-lock.json` committed; Docker images now install with `npm ci` from the lockfile. Added `.dockerignore`.

### Changed
- API entrypoint split into `buildApp()` (`api/src/app.ts`) and the server start (`api/src/index.ts`) so tests can run the app in-process.

## [0.2.0] — 2026-09-07

### Added
- Host **auction list** on `/host` (reopen past events; signed-in email + log out in the top bar). Logged-in visits to `/` redirect to the dashboard.
- Per-auction **currency**: USD, EUR, or THB (create form and auction settings). Amounts render with `$` / `€` / `฿`.
- Item **photo file upload** (jpg/png/webp/gif), stored under `DATA_DIR/photos` and served at `/api/events/:code/items/:itemId/photo`.
- **Users** on Host, keyed by **email**:
  - Auction guests: list and add by email (name optional).
  - Extra **host** logins: owner can add/remove by email (cannot remove the owner or themselves).
- Guest join is email-first; name is optional (defaults to the local part of the email).

### Changed
- Adding an item is a single **multipart** request (`title`, `startingBid`, `minIncrement`, `voucherPdf`, optional `photo`). JSON item create is rejected.
- Guest bid/join/invoice/stats pages no longer show FlüsterLos or Host login chrome. Bid is one tap at the next amount.
- PromptPay QR **amount is filled only for THB** auctions; other currencies show the formatted total to enter in the banking app.

### Fixed
- Create event failed with `multipart required: title, startingBid, minIncrement + voucherPdf` because the Host UI posted JSON for items.

## [0.1.0] — 2026-09-06

### Added
- First vertical slice: create event, QR join, live bid, public stats, big-screen engager.
- Host auth: `BOOTSTRAP_TOKEN` first-owner register, email + bcrypt password, httpOnly session cookie.
- Vouchers + Thai PromptPay: one invoice per winning guest, payslip upload, host confirm, SMTP voucher PDFs.
- CSS theming (`theme.css` + `custom.css`) with gala default.
- Prebuilt GHCR images and `docker-compose.ghcr.yml`.
