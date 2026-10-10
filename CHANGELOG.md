# Changelog

All notable changes to FlüsterLos are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project versions toward [SemVer](https://semver.org/).

## [Unreleased]

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
