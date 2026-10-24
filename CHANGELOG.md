# Changelog

All notable changes to FlüsterLos are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project versions toward [SemVer](https://semver.org/).

## [Unreleased]

### Added — CI

- GitHub Actions runs typecheck, the API tests against Postgres, the web tests and the web build on every pull request and on pushes to `main` (`.github/workflows/ci.yml`).

### Added — Fund-a-Need

- A second category beside the auction. Guests switch **Auction** / **Donate**. Needs have a target, preset amounts, an optional unit stepper, and a gold progress bar. Pledges are binding, with Undo for 10 seconds, and can be anonymous on the big screen. They may pass 100% (“110% funded”) unless the host caps the need. Fund-a-Need stays open after the auction, or ends at its own time.
- Hosts create, edit, reorder, hide and close needs, spotlight one need, and correct or void a pledge with an audit trail. Tables and exports include pledges.
- The big screen rotates between auction highlights and Fund-a-Need bars, runs a pledge ticker, celebrates 100%, and can hold a host-triggered spotlight.
- The receipt lists won lots and donations separately, with subtotals, a grand total, and a name for the donation receipt.
- Three example needs for the Thai.GER charity (playground, school uniforms, lunches), labelled as example data. Hosts add them from the event card.
- Tests: `api/test/pledges.test.ts` (units, caps, the 10-second undo, concurrent pledges, totals across guest, host, big screen and invoice) and `web/test/pledges.test.ts`.
- Donation payment routing. A guest’s donation total of ฿10,000 or more is paid via Mercy Centre; below that, via Wolfgang’s QR. The threshold and both channels are host settings and start empty (placeholders are example text, not saved accounts). Auction lots keep the existing payment flow. The host can override the channel per guest, with an audit trail, and exports include the channel. Tests: `api/test/donationRoute.test.ts`.
- Opt-in donor recognition. **Name me publicly** is off by default, with an editable public name and a separate “show my amount” choice. Needs list **Supported by**, and **Top donors** ranks public gifts only (not auction bids) for guests and the big screen. The host can turn recognition and the big-screen frame on or off, set how many names to show, spotlight Top Donors, and edit or hide a display name with an audit trail. Exports add **Named publicly** and **Public name**. Tests: `api/test/recognition.test.ts`.
- Big-screen auction countdown. A pinned HH:MM:SS clock stays the same size on every frame, including Fund-a-Need, spotlight, Top Donors and the ticker. Under 15 minutes it pulses gold, under 5 minutes it grows, under 60 seconds the main area shows the seconds, then **Bidding closed**. It follows the server end (extend and close-early included). A different Fund-a-Need end is a smaller “Donations open until …” line. Tests: `web/test/auctionClock.test.ts`.

### Fixed — click test round 5

- **Undo after buy-now**: the Undo toast now lasts 8 s after a fixed-price purchase (5 s after a bid; the server-side undo grace stays 15 s). The toast timer is keyed to the toast and doesn't restart or close when the page re-renders or live updates arrive. It also pauses while the tab is hidden or the pointer is over the toast.
- **Stray quotes in descriptions**: new `tidyDescription` drops description lines that are only punctuation or quotes. It also trims quotes that wrap a line and a single unmatched quote at the start or end. This runs on workbook import and when guest, host and import-preview screens show descriptions, so existing data is cleaned too.
- **Host item list**: fixed-price items now read "Fixed price ฿3,000" or "Sold at fixed price ฿3,000".
- **Guest**: the "Add to home screen" bar and the name prompt record their height in `--g-bottom-bar`, and the item list adds that much bottom padding so the last card is never covered.
- **Big screen spotlight**: shows the featured item's real state (current bid with leader and bid count, starting bid with no bids, fixed price, sold, won). It prefers items with recent bids, shows an unbid item every third turn, and jumps to an item when it gets a new bid.
- **Big screen grid**: cards stretch to fill the available height. At 1024×600 the layout is compact, so nothing is clipped and the page doesn't scroll.
- **Big screen paging**: pages now turn every 8 s. Before, the timer restarted whenever the board resized, so pages turned every 10–15 s.
- Tests: `api/test/round5.test.ts` and `web/test/round5.test.ts`. The synthetic import fixture now includes quoted fixed-price descriptions.

### Fixed — click test round 4 (48-item event, real workbook import)
- **"Raised so far" counted starting bids of unbid items** (big screen showed ฿64,300 while bids summed ฿7,200). The live total is now the sum of current high bids of items **with bids** (buy-now sales included); new `stats.itemsWithBids`. The stats page lists only items with bids as leaders and counts the rest separately.
- **Big screen for large events:** the "All items" row (3 clipped cards, no scroll) is now a **paged grid** sized to the screen (8–12 cards, auto-advance every 8 s, page indicator; no fade with reduced motion). **🔥 Hot** items (recent + most bids; `recentBids[].itemId` added to the live payload) are outlined and the spotlight jumps to an item on a new bid. The 27-tile sponsor block (half the screen) is a **single compact row** (marquee when it overflows, static pages with reduced motion), ≤ ~12 % of the height. Compact layout for 1280×720; the header stays on one line.
- **Import preview:** "⚠ N to check" counted warnings while the filter showed rows — both now count **rows to check** (`summary.rowsToCheck`). Price/increment/buy-now cells update the preview (and the item count) ~350 ms after typing stops, not only on blur; title edits keep focus.
- **Bulk media:** the footer said "0 of 8 files matched" after a successful upload — it now says **"✓ 8 files uploaded"** (and what is left). The "Goes to" list for a PDF shows only voucher items (grouped), photos all items.
- **Fixed-price lots (buy-now = starting bid):** the guest card shows **Fixed price ฿3,000** and **Buy for ฿3,000** (no "Starting bid · No bids yet"); after the purchase the buyer sees **Yours ✓**, others **Sold** (not "You're winning"). Still one tap + the Undo toast (no confirm); undoing a buy-now reopens the lot (tested). Host item list tags them **fixed price**.
- **Host item list:** "high ฿2,000.00 · 0 bids" → **"Starting ฿2,000 · no bids"** (also "High ฿2,400 · 3 bids", "Sold ฿3,000").
- **Payment desk:** the "At the desk — hand over: …" hint drops items as soon as they are ticked *Handed over* and disappears when all are.
- **Payment settings:** saving shows "✓ Saved — PromptPay …" next to the button (plus a toast).
- **Exports:** the host-only *Notes* column (may contain names) is now **off by default** and, when included via the new **Include host notes** checkbox (`?notes=1`), is the **last** column.
- **Guest polish:** the event title wraps to two lines (the countdown pill stacks on phones to give it room); a description line or leading phrase repeating the title is stripped (accent/case/punctuation-insensitive, on import and on display); the name card is a **bottom sheet** shown after the bid toast — it no longer pushes cards under the guest's finger (saving confirms with a toast); the import and bulk-media drop zones have a styled **Choose file(s)** button instead of the native control.

### Tests
- API: totals ignore unbid items and include buy-now sales; buy-now undo reopens the lot; export without/with notes (CSV + XLSX); description dedupe; rows-to-check count; a synthetic **48-lot / 27-sponsor workbook** (`buildLargeWorkbook()`) imports with fixed-price lots included by typing their price.
- Web: big-screen paging/fit/hot helpers, host price line, fixed-price detection, bulk-media targets and footer, desk hint after handover, description dedupe.

### Added — host item import (Excel / CSV)
- **Import items** on the event card: upload `.xlsx` / `.csv` → preview → **Import N items**. Built around last year's `Prizes` workbook layout (header in row 3, bid sheets `Liste N` ignored, results/buyer columns never imported).
  - Column auto-detection for English and German headers; any column can be re-mapped in the preview (unmatched columns highlighted).
  - Preview table per row: import yes/no, title (editable), type voucher/physical (guessed, editable), sponsor (*new* / *existing*), retail value, starting bid, increment, buy-now (editable), quantity, notes, and per-row errors/warnings. Rows with errors are not imported until fixed or unticked.
  - Defaults: increment = 10 % of the starting bid (last year's `=E11/10`), starting bid = 20 % of the value when only a value is given (flagged), title from the first line of the description.
  - Multi-unit lots (`10x` in a quantity column, title prefix, or misplaced in "Organized by") become N items `Title (1/N)` … `(N/N)`.
  - `#VALUE!` cells, numbers stored as text, totals rows and a *sold / not auctioned* lot (skipped by default, or imported as fixed-price buy-now) are handled.
  - Photos embedded in the workbook (also on bid sheets that reference a `Prizes` row) become item photos; logos next to a "Logo" label fill missing sponsor logos.
  - Downloadable blank template (`GET /api/host/import/template.xlsx`).
  - Only allowed while the auction has no bids and isn't closed (checked again inside the import transaction under the event lock).
  - API: `POST /api/host/events/:code/import` (file → preview), `POST …/import/:session/preview` (re-map / row edits), `POST …/import/:session/commit`, `GET /api/host/import/:session/images/:file`. Upload sessions live in `DATA_DIR/imports/` and are removed after import or 24 h.
- **Photos & PDFs** bulk upload (after an import, or any time from the event card): files are matched by lot number (`03-spa.jpg`) or title (`Spa Day.pdf`), every match can be corrected, then uploaded one by one via the existing per-item endpoints.
- **Retail value** per item (`items.retail_value`): shown to guests as "Value ฿X", editable in the item form, new *Retail value* column in the results export.
- Host-only **notes** per item (`items.notes`, e.g. "Organized by: …" from an import): item form + export *Notes* column; never in the public live payload (`GET /api/host/events/:code/item-notes`).
- Host item list shows lot numbers **#1, #2, …** (same as the export).

### Changed
- Buy-now may now **equal** the starting bid (fixed-price lot: guests see only "Buy now"); before it had to be greater.
- Guest item descriptions keep their line breaks.
- Web test typecheck (`npm run typecheck`) passes again (duplicate import in a test, missing `__BUILD_ID__` declaration in the test tsconfig).

### Fixed — guest UX click test, round 3
- **Privacy: no phone digits in public.** Board, big screen, stats and the live feed showed `Guest …2222` although the join page promises the number is never shown. Guests now get a neutral **per-event number** (`Guest 7`): new `guests.guest_no` column, assigned by a `BEFORE INSERT` trigger (per-event advisory lock, so numbers are unique and gap-free per event). The migration backfills existing guests and renames legacy `Guest …1234` / email-derived default names. Resetting the board name falls back to `Guest N`. Only the host desk still sees phone numbers.
- **After the close:** lost items show a neutral grey **Not won** (no red "↑ Outbid"), won items **Won**, prices read **Winning bid**, and the filters become **All / Won / Not won**.
- **Stale app after a deploy (root cause + fix).** The old service worker answered every navigation with its precached `index.html` (cache-first) and pre-round-2 pages had no reload handler; Chrome also postpones its own service-worker update check while navigations keep coming, so impatient reloads kept showing the old app (reproduced in headless Chrome: old build still shown after 8 quick reloads). Now:
  - navigations are **network-first** (`NetworkFirst`, 4 s timeout; precached `index.html` only as the offline fallback) instead of the cache-first `navigateFallback`;
  - versioned precache (`cacheId: fluesterlos-v3`), so the old precache is deleted on activate; `skipWaiting` + `clientsClaim` as before;
  - **kill-switch:** each build publishes `/version.json` (build id also compiled into the bundle); a page running an older bundle reloads once (guarded per build in `sessionStorage`, never loops; waits while the guest is typing). `nginx.conf` / `vite preview` send it with `no-store`;
  - `reg.update()` on every load; `controllerchange` reloads only when the running bundle is actually outdated (no needless second reload).
  - Measured with real headless Chrome (install old build, deploy new, reopen): pre-fix 2b0a114 → 9337ca4 needed 1 manual reload after waiting ~3 s and was **still old after 8 quick reloads**; with this release a later deploy is live on the **first load (0 reloads, ~0.25 s)**. The one-time switch from 9337ca4 to this release is still driven by the old worker: one automatic reload.
- **Code screen:** the pending code step (number + delivery) is kept for 15 min, so switching to the mail app or walking to the desk no longer loses it. "Send a new code" is now **"Ask the desk for a new code"** for desk codes and **"Email me a new code"** for emailed ones, with honest feedback when the last code is still valid.
- **Banners:** the outbid banner is a compact one-line bar; the add-to-home-screen hint is a small dismissible **bottom bar** and is never shown together with the outbid banner, a bid toast or the name card.
- **Filter chips fit 390 px:** shorter labels (**All / Mine / Winning / Outbid**), smaller padding, wrap instead of a hidden horizontal scroll.
- **Invoice:** "Payslip received" appears once; for voucher winners without an email the email card comes **first, above payment** (highlighted, "Later" skips it); the desk note names the prizes ("Collect Signed Jersey at the desk.").
- **Big screen:** money formatted like the guest app (`฿7,100`), a real **QR code** for the join URL, **"Raised so far"** instead of "Live total (sum of high bids)", a board of all items with current bid and leader in the former empty half, larger latest bids, and same-size sponsor tiles (logo + name, or a styled name tile). Fits one TV screen. Host screens (`formatMoney`) now use thousands separators too (`฿7,100.00`); stats use the guest format.
- **Small things:**
  - **Undo** for 5 s on the bid toast (with a shrinking timer line). New `DELETE /api/events/:code/bids/:bidId`: only the bidder, only while the auction is open, only while it is still the top bid on the item, within a 15 s server window; publishes a live update.
  - **"Not you?"** asks inline ("Use a different number on this phone? Your bids stay safe.") and also lives in a new **⋯ header menu** (who is bidding, change board name, pay link after the close).
  - Saving the board name shows **"✓ Saved — you appear as Anna"** in place of the card.
  - Bigger sponsor logos on item cards (40 px).
  - **Start bidding** (and the Save buttons) never look disabled; an incomplete number gets an inline hint instead.

### Changed — guest experience redesign
- **Join in one step:** `/e/<code>` asks only for the mobile number (big field, numeric keypad, auto-format with a Thai default) and has one **Start bidding** button. There are no name or email fields. A guest whose session cookie is still valid goes straight to the items. The code step appears only for a number already used on another phone, with friendlier wording, and submits automatically once 6 digits are in.
- **Bid page (mobile-first):**
  - Each item card has photo, sponsor logo, current bid and a big one-tap **Bid ฿X** with a −/+ stepper (clamped to the minimum and buy-now), plus buy-now.
  - Clear **You're winning** (green) / **Outbid** (red) per item. Being outbid shows a non-blocking banner with a one-tap re-bid and a vibration where supported.
  - Filter chips **All / My bids / Winning / Outbid**.
  - Bids are confirmed with a toast instead of a dialog.
  - The countdown and open/closed switch follow the **server clock**.
  - Closed state: **"You won N items — Pay now"**.
- **Name later:** a small, dismissible "Show your name on the board?" appears after the first bid. New endpoint `PUT /api/events/:code/me/name`; guest payloads include `nameSet`. The board shows `Guest …1234` until a name is set.
- **Invoice on one screen:**
  - Total, a large PromptPay QR with **Save QR** (share sheet / download; long-press also works in LINE) and a big payslip button that uploads as soon as a file is picked.
  - Email is asked only when a voucher was won, prefilled if known.
- **Add-to-home-screen hint:** non-blocking and dismissible, shown only after the first bid, with iOS-specific instructions. Never shown in LINE or other in-app browsers.
- **Look and copy:** the design matches the big-screen theme (`theme.css` variables; CSS-only theming still works). Tap targets are at least 48 px, labels are accessible and `prefers-reduced-motion` is respected. Guest copy lives in a string table (`web/src/i18n`), ready for more languages; English only for now.
- **Smaller download:** host pages, the invoice, stats and the big screen are lazy-loaded. Host code is excluded from the service-worker precache, so guests never download it. The entry JS went from 350.6 kB to 297.9 kB (gzip 109.1 → 95.3 kB).
- **README** rewritten for the current app, with guest screenshots in `docs/screenshots/`.

### Fixed — browser click test, round 2
- **Silent re-login on the same device:** after "Not you? Log out", logging back in with the same phone on the same device no longer asks for a help-desk code. The API issues a long-lived, httpOnly device cookie (`fl_device`, random id; only a SHA-256 hash is stored per guest in the new `guest_devices` table). A device is trusted for a guest only after successful sign-in (new join, verified code, own token, or a valid session via `/me`); asking for a code doesn't trust it. A new device (or a trusted device used with someone else's phone) still needs a code, so there's still no impersonation. Logout ends the session but keeps the device trusted.
- **Updates after a deploy are reliable:** `index.html`, SPA routes, `sw.js`, the workbox runtime and the manifest are served with `Cache-Control: no-cache`, and hashed `/assets/*` with `public, max-age=31536000, immutable`. This applies in both `web/nginx.conf` and `vite preview` (new `web/cacheHeaders.ts` plugin). The app now registers the service worker itself (`updateViaCache: "none"`), checks for updates every 10 min and whenever the tab becomes visible, and **reloads automatically** when a new version takes control. If the user has unsaved input, the reload waits until the input is gone or the tab is hidden. Guests get no prompt; host pages also show a non-blocking "Update available — Reload" banner. `index.html` is precached with a content revision.
- **Payment desk, missing voucher PDF:** the desk no longer says "print/show voucher(s)" for a voucher that has no PDF. It shows "⚠ Voucher PDF missing: … — attach it to the item on the event card before handing over or emailing", and each affected invoice gets a "voucher PDF missing" badge.
- **New-event form:** sponsors typed for earlier items are suggested for later items (chips + autocomplete), with the logo chosen there previewed and reused. The start time defaults to **now** (current minute) and the end time to +2 h. After you create an event, its card scrolls into view and is highlighted briefly.
- **Export:** timestamps are in the **event's time zone** (`YYYY-MM-DD HH:mm`), and the header names the zone, e.g. `Paid at (Asia/Bangkok, UTC+7)`. In xlsx they are real date cells holding that wall time. **CSV phone numbers have no apostrophe any more:** they are written in a readable form that can't be read as a formula, `081 234 5678` for the default country (`DEFAULT_PHONE_COUNTRY`) and `(+49) 1512 3456789` otherwise. Other cells starting with `= + - @` are still neutralised. In xlsx, phones stay E.164 (`+66…`) in a text-formatted column.
- **Handover tick:** a short toast confirms it ("✓ Handed over: Spa → Anna" / "Handover undone").

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
- API test suite (Vitest + `fastify.inject` against real Postgres) and a CI workflow for typecheck, tests and the web build. It now runs from `.github/workflows/ci.yml`.
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
