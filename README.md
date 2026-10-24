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

- **Guests** bid on their phones, and can fund a charity need together. There is no app store, no account and no password.
- **Hosts** (the organising team) create the event, the lots and the Fund-a-Need items, watch the room, collect payments and hand over prizes.
- **The room** watches a big-screen view with live totals, recent bids and Fund-a-Need progress.

It is aimed at small and medium charity events (Rotary/Lions clubs, school galas, NGO dinners) that want to run it themselves. It is built Thailand-first (PromptPay, `Asia/Bangkok`, Thai phone numbers) but works with USD and EUR and any time zone.

## Guest flow

| | |
|---|---|
| <img src="docs/screenshots/guest-01-join.png" width="220" alt="Join screen"> | **1. Scan → phone → bid.** The QR opens `/e/<code>`. The only screen asks for a **mobile number**: big field, numeric keypad, auto-formatted while typing (Thai default, e.g. `081 234 5678`; `+…` for other countries). One tap on **Start bidding** opens the items. No name, email or sign-up is asked here. |
| <img src="docs/screenshots/guest-03-bid-page.png" width="220" alt="Bid page"> | **2. Bid.** Each item is a card with photo, sponsor logo, current bid and a big one-tap **Bid ฿X** for the next valid amount. A −/+ stepper lets guests bid more, and there is **Buy now** where the host set one. A **fixed-price** lot (buy-now = starting bid) shows just **Fixed price ฿3,000** and one **Buy for ฿3,000** button; afterwards the buyer sees **Yours ✓** and everybody else **Sold**. The countdown follows the server clock. Updates are live (SSE). Each bid — and each buy-now purchase — is confirmed with a short toast with **Undo** (5 s; 8 s after a purchase), so a mis-tap costs nothing and there are no confirm dialogs. |
| <img src="docs/screenshots/guest-05-outbid.png" width="220" alt="Outbid"> | **3. Winning / outbid.** Every item a guest bid on shows **✓ You're winning** (green) or **↑ Outbid** (red). When a guest is outbid, a card sits under the header — navy surface, red only on the icon and the left edge — with a one-tap **Bid again**, and the phone vibrates where supported. Filter chips that fit any phone: **All / Mine / Winning / Outbid**. After the first bid (once its toast is gone) a small, dismissible **bottom sheet** offers **"Show your name on the board?"**; it floats over the list, so no card moves under the guest's finger, and saving confirms with a toast. Until then the board shows a neutral per-event number like `Guest 7`, never any digits of the phone number. The **⋯** menu shows who is bidding and offers "Change board name" and "Not you?" (with an inline confirm). |
| <img src="docs/screenshots/guest-08-new-device-code.png" width="220" alt="Code step"> | **4. A code only when it's really needed.** If the number is already bidding on *another* phone, the new phone asks for a 6-digit code. The code is emailed if the guest has an email on file and SMTP is set; otherwise the host reads it off the **Help desk** card ("Ask the desk for a new code"). The code step survives switching to the mail app or walking to the desk. Logging in again on the *same* phone, even after "Not you?", happens silently. |
| <img src="docs/screenshots/guest-09-closed.png" width="220" alt="Closed"> | **5. Closed.** The page switches at the closing second: **"You won 2 items — Pay now"**. Items show **Won** (green) or a neutral grey **Not won**, prices read **Winning bid**, and the filters become **All / Won / Not won**. |
| <img src="docs/screenshots/guest-10-invoice.png" width="220" alt="Invoice"> | **6. Pay.** One screen with the total and a large **PromptPay QR**. The amount is filled in for THB. **Save QR** opens the share sheet or downloads the image, and a long-press on the QR saves it too (useful in LINE). The guest can **upload a payslip** (camera or gallery); it uploads as soon as it's picked. **Email is asked only here, and only if they won a voucher**: then it comes first, above payment, so it isn't missed ("Later" skips it). Physical prizes name the item: "Collect Signed Jersey at the desk." |

More details:

- **Add to home screen:** a small dismissible bottom bar, shown only after the first bid, never on the join screen and never at the same time as the outbid banner, a bid toast or the name card. iOS gets Share → "Add to Home Screen" instructions; Android gets an install button when the browser offers one. It is never shown inside LINE or other in-app browsers, and dismissing it is permanent.
- **Accessibility:** tap targets are at least 48 px, inputs use 16 px+ text (no iOS zoom), labels are accessible, focus rings are visible and `prefers-reduced-motion` is respected.
- **Strings:** all guest text lives in a string table ([`web/src/i18n/en.ts`](web/src/i18n/en.ts)). Thai or German can be added as another table; only English ships today.
- **Two categories.** A segmented control at the top of the bid page switches **Auction** and **Donate**. Auction keeps All / Mine / Winning / Outbid. Donate lists the needs, each with a gold progress bar. **Raised so far** is the auction total plus donations, with the split written underneath. **Mine** on the auction list also shows the guest's pledges.

## Fund-a-Need

Auction lots stay as they are: a sponsor brings an item, guests bid, the highest bid wins. Fund-a-Need is the other half of the evening. Guests fund a specific thing for the charity together — a playground, uniforms, a year of lunches. Many people can give to the same need. It is not an auction.

Each need has a title, the charity or beneficiary, a description, a photo (or the same gift placeholder the lots use), a target in THB, optional preset amounts (฿1,000 / ฿5,000 / ฿10,000 / ฿25,000, edited per need), and optionally units (one uniform is ฿800, chosen with the same −/+ stepper as a bid). A guest picks a preset, a number of units, or a custom amount at or above the minimum, and confirms with one gold button. The pledge is binding, like a bid. Undo sits on the toast for 10 seconds. **Name me publicly** is off unless the guest opts in. They can type a family or company name (prefilled from their guest name) and, separately, choose to show the amount. Otherwise the room says “A guest”. They can change that later from **Mine**. Each need lists **Supported by** with the public names (amount only when the donor asked), plus “+ N anonymous gifts”. **Top donors** ranks public gifts across every need — auction bids are not included — on a guest tab and on the big screen. Gold, silver and bronze mark the top three. A name that enters the top three or moves up gets a short celebration; reduced motion skips the animation. The host can turn recognition off, turn the big-screen frame off, choose how many names to show (default 10), spotlight that frame, and edit or hide a display name. The reason stays in an audit trail. Exports add **Named publicly** and **Public name**.

The bar fills gold toward the target and shows the amount raised and the donor count. At 100% it reads **Fully funded!** (the pop respects `prefers-reduced-motion`). Gifts can continue past the target — the label becomes **110% funded** and the bar stays full — unless the host caps the need. Fund-a-Need does not follow the auction countdown. It stays open, or it ends at its own time. A time on one need overrides the event time.

**Host.** On the event card: create, edit, reorder, hide and close needs; set the target, presets, units, end time and cap; put one need in the **spotlight**; see pledges per need and per guest; correct or void a pledge (a reason is required, and the audit line stays). **Add example needs** inserts three sample items for the Thai.GER charity (playground ฿150,000, uniforms ฿24,000 at ฿800 each, lunches ฿36,000 and capped). Each one is badged **Example** and its description starts with “Example data for the Thai.GER Supporters gala.”

**Big screen.** A large **HH:MM:SS** auction countdown stays pinned on every frame — auction highlights, Fund-a-Need, spotlight, Top Donors and the pledge ticker. It uses the server end time, corrected by the same clock offset as the phones, so every screen shows the same second, and it jumps if the host extends the auction or closes it early. Under 15 minutes it pulses gold and reads **Last 15 minutes**. Under 5 minutes the digits get bigger. Under 60 seconds the main area becomes the seconds. Then it reads **Bidding closed**. Reduced motion keeps the colour and drops the pulse. If Fund-a-Need has its own end, a smaller line says **Donations open until 22:30** and is not the auction clock.

**Paddle raise.** During the speech the host starts a paddle raise on a need, or on a general appeal, with levels such as ฿50,000 / ฿20,000 / ฿10,000 / ฿5,000 / ฿2,000. The big screen keeps the auction countdown and replaces the rotating frames with the current ask (“Who raises at ฿20,000?”), a running total against the goal, and each new pledge. A guest who asked to be named appears by that name; everyone else is “A generous guest”. A goal lights the panel gold. Guests pledge with one tap at the current level. The host can add a paddle seen in the room by name or guest number, then pause, move to the next level, or end. Those pledges join the guest’s donation total, so the ฿10,000 Mercy Centre / Wolfgang QR rule and the invoice still apply. The countdown’s final minute yields the main area only when a paddle raise is not on screen.

The room still alternates every 6 seconds between auction highlights, Fund-a-Need progress and, when the host leaves it on, Top Donors. A new pledge pins the needs view and runs a ticker (“The Müller Family funded 3 uniforms”, or “A guest pledged ฿5,000” when the gift is not public). Crossing 100% fills the screen with **Fully funded!** for a few seconds. The host can hold one need in **Fund-a-Need spotlight**, or hold **Top donors**. With reduced motion the ticker is one static line and the celebration does not animate.

**Invoice.** After the auction closes, the receipt lists won lots and donations in two sections, each with a subtotal, then a grand total. Donation lines are marked as donations and no item is handed over. A guest who only gave, and won nothing, still gets an invoice. Paying freezes it. Exports add a pledges block (CSV only when there are pledges; the xlsx file always has a Pledges sheet) with a **Payment channel** column. The auction “Results” sheet is unchanged.

**Where a donation is paid.** The host sets one threshold (default ฿10,000; an equal amount goes to Mercy Centre) and two channels under **Donation payment channels**. Both start empty. The form placeholders are example text and are not saved — no account number, name or PromptPay ID is filled in for you.

- **Mercy Centre** — display name, instructions, bank details and/or a payment link and/or a QR image, plus a note that Mercy Centre issues the donation receipt. The invoice asks for the name or company and an email for that receipt.
- **Wolfgang’s QR** — display name and a QR image. If a PromptPay ID is entered and no image is uploaded, the invoice shows a PromptPay QR for the exact donation total.

The rule uses the guest’s **donation total**, not each pledge on its own. Auction lots keep the existing PromptPay / desk payment and are not added into that total. The host sees the channel on the pledge list and can override it per guest; the reason is kept in an audit trail. Voiding a pledge recomputes the channel, unless an override is set.

## Host flow

Open **`/host`**. The host desk uses the same navy and gold gala skin as the phones and the big screen.

<p align="center"><img src="docs/screenshots/host-auctions.png" width="760" alt="Host auctions list: navy cards, gold actions, no lime stripe"></p>

1. **Register the owner.** The first registration needs the one-time `BOOTSTRAP_TOKEN` from your env; after that, registration is closed. Hosts sign in with email + password (bcrypt, httpOnly session cookie). The owner can add and remove more host logins by email.
2. **Payment settings:** a PromptPay ID (phone or 13-digit national ID) and payee name, and/or an uploaded static QR image. Saving shows "✓ Saved — PromptPay …" next to the button.
3. **Create an event:** title, currency (USD / EUR / THB) and **time zone** (default `DEFAULT_EVENT_TIMEZONE`). Start/end are entered and shown in the event's zone, whatever zone the host's device is in. Start defaults to now and end to +2 h. Each item has:
   - title, description, starting bid, increment, optional buy-now (buy-now = starting bid makes a **fixed-price** lot: guests only see "Buy now")
   - optional **retail value** (guests see "Value ฿X"; also in the export) and host-only **notes**
   - optional **photo** (uploaded file)
   - type **voucher** (PDF emailed after payment; the PDF can be attached later) or **physical** (collected at the desk)
   - optional **sponsor** name + logo. Sponsors are reused by name, and a sponsor typed for an earlier item is suggested for later ones.
4. **Event card:** join QR + link, links to Stats and the big screen, and live totals (paid / handed over). Host controls:
   - **close now**
   - **extend** (up to 24 h at a time). On a closed event this **reopens** it, as long as nothing has been paid.
   - **edit times**
   - **edit / delete items** (items are numbered **#1, #2, …** — the same lot numbers as the export). Each line reads "Starting ฿2,000 · no bids", "High ฿2,400 · 3 bids" or "Sold ฿3,000"; fixed-price lots carry a **fixed price** tag.
   - **Import items** from Excel / CSV and **Photos & PDFs** in bulk (see below)
5. **Users:** list guests, or add them in advance by phone; such a guest's first join needs no code. Extra host logins are managed here too.
6. **Help desk:** shows pending 6-digit login codes, so a host can check who someone is and read the code out.
7. **Payment desk** (after close): one invoice per guest who won a lot or made a pledge. Lots and donations are listed separately, with subtotals and a grand total. Donation rows say they are donations (nothing to hand over) and show the receipt name.
   - Mark paid by **cash / bank transfer / PromptPay**. Transfers without a payslip need an explicit "I checked the transfer arrived".
   - Marking paid emails the voucher PDFs (one attachment per won voucher). If a voucher PDF is missing, the desk warns ("voucher PDF missing") and holds the email until the PDF is attached; then press **Send email**.
   - Tick **Handed over** per item (only after payment; time and host are recorded). A toast confirms it, and the "At the desk — hand over: …" hint drops the item at once (and disappears when everything is handed over).
8. **Export:** `results.xlsx` / `results.csv` with one row per lot, including unsold ones. Columns: lot, item, type, sponsor, retail value, winner, phone, email, amount, currency, paid, method, paid at, handed over, handed over at. When the event has pledges, the CSV continues with a pledges block and the workbook adds a **Pledges** sheet (guest, phone, receipt name, need, amount, units, anonymous, status).
   - Host-only **notes** (e.g. "Organized by: …") can contain names, so they are left out by default; tick **Include host notes** next to the export links to add them as the last column (`?notes=1`).
   - Timestamps are in the event's time zone, which is named in the header.
   - CSV phones are readable without a leading `+` (`081 234 5678` for the default country, `(+49) 1512 3456789` otherwise), so spreadsheets don't treat them as formulas.
   - xlsx keeps E.164 as text.

### Importing items from Excel / CSV

**Event card → Items → Import items** (only before the first bid). Upload an `.xlsx` or `.csv`; nothing is created until you press **Import N items**. The summary counts **rows to check** (exactly the rows the "only rows to check" filter shows), and the item count follows your edits as you type a price.

<p align="center"><img src="docs/screenshots/host-import-preview.png" width="760" alt="Import preview on the navy and gold theme: column mapping, summary, editable rows"></p>

- **Sheet & columns:** the sheet named `Prizes` (also `Preise`, `Items`, `Lots`) is used, otherwise the first sheet that isn't a paper bid sheet (`Liste 1`, `Liste 2`, … are ignored). The header row is found automatically (last year's file has it in row 3). English and German headers are recognised (`No.`/`Nr.`, `Title`/`Titel`, `Description`/`Beschreibung`, `Sponsor Name`/`Spender`, `Approximate Value`/`Wert`, `Suggested Minimum`/`Mindestgebot`, `Minimum Steps`/`Schrittweite`, `Buy now`/`Sofortkauf`, `Quantity`/`Anzahl`, `Remark`/`Bemerkung`, `Organized by`, …). Result columns of a past auction (`Final Price achieved`, `Bought by`, `Money received?`, `Payment Method`, `Handed over?`) are never imported. Any column can be (re)mapped with a dropdown; unrecognised columns are highlighted.
- **Defaults:** no title column → the first line of the description (dates in brackets stay in the description; a "retail value …" line is dropped because the card shows the value). Increment missing → **10 % of the starting bid** (last year's bid sheets used `=E11/10`). Starting bid missing but a value given → 20 % of the value (flagged). Type is guessed — **voucher** if the text mentions voucher / Gutschein / hotel / night / spa / brunch / dinner / restaurant / massage …, else **physical** — and can be changed per row. Sponsors are matched to existing ones by name (case-insensitive) and marked *new* / *existing*. "Organized by" goes into the host-only notes.
- **Multi-unit lots:** `10x` in the quantity column, in the title (`10x Brunch`) or — as in last year's file — in the "Organized by" column becomes **10 separate items** `Brunch (1/10)` … `(10/10)` (warning in the preview).
- **Messy cells:** `#VALUE!` and other error cells, numbers stored as text (`14.000`, `1,250`, `THB 2 500`), multi-line text and totals rows are handled. A lot marked *sold / not auctioned / Festpreis* is **skipped by default**; tick it and enter a price to sell it at a fixed price (buy-now only). A description line that just repeats the title is dropped.
- **Pictures from the workbook:** images on the item sheet, or on paper bid sheets that reference a `Prizes` row (`=Prizes!C4`), are attached as the item photo; the image next to a "Logo" label becomes the sponsor's logo if the sponsor has none yet.
- **Template:** a blank `fluesterlos-items-template.xlsx` (columns *No., Title, Description, Type, Sponsor, Retail value, Starting bid, Increment, Buy now, Quantity, Notes* with explanations) is linked in the import panel.

**Photos & PDFs** (offered right after an import, and as a button on the event card): drop many files at once. Each file is matched by **lot number** (`03-spa.jpg`, `Lot 3.pdf`) or **title** (`Spa Day.pdf`); every match can be changed in a dropdown before uploading (a PDF can only go to a voucher item; a photo to any item). A photo named after a multi-unit lot goes to all of its units; a voucher PDF only ever goes to one item. After the upload the footer reads "✓ 8 files uploaded". Per-item upload in the item editor works as before.

## Big screen

- **`/e/<code>/engager`:** full-screen room display that fits one TV screen (tested at 1920×1080, 1280×720 and 1024×600 with 48 items; cards stretch to fill the height):
  - **Raised so far** — the sum of the current high bids of items that *have* bids (buy-now sales included; starting bids of unbid items never count), plus Fund-a-Need once any need or pledge exists, with the auction and donation amounts split underneath;
  - a highlighted item showing its real state (current bid and leader, starting bid, fixed price, sold); it rotates every 6 s, prefers items with recent bids and jumps to an item the moment it gets a bid; and a **scannable join QR**;
  - the **item board, paged**: as many cards as fit (8–12 per page), advancing every 8 s with a page indicator ("13–24 of 48"); the top three lots by amount wear a rank badge, a new bid washes that row gold for a few seconds, and the 3 **Hot** items (most bids in the last 5 minutes, then most bids) are outlined in gold;
  - the latest bids;
  - a **single compact sponsor row** (≤ ~12 % of the height): it scrolls as a slow marquee when the sponsors don't fit, or — with `prefers-reduced-motion` — shows them page by page.
  Amounts look like the guest app (`฿7,100`). It is live and animated in the active event theme.

<p align="center"><img src="docs/screenshots/bigscreen.png" width="640" alt="Big screen: total, featured item, join QR, item board, latest bids, sponsors"></p>
- **`/e/<code>/stats`:** a simpler public stats page (same "Raised so far" rule; items without bids are counted separately, not listed as leaders).

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
  - Page navigations are **network-first** (the cached app shell is only the offline / slow-network fallback), so a deploy shows up on the **first load**. The precache name is versioned and old caches are deleted when the new service worker activates.
  - Every build publishes `/version.json` with its build id; if a page runs an older bundle it reloads once (guarded, never loops). The app also checks for a new service worker on every load, every 10 min and whenever the tab comes back into view, and **reloads itself** when one takes over and the running bundle is outdated. If someone is typing, the reload waits until the input is gone. Guests never get a prompt; host pages show a small "Update available" banner.
- **Guests don't download host code:** host pages are lazy-loaded and not precached.

## Security notes

- **Guest identity = phone number per event.** The full number is never shown publicly; the board, big screen and stats show a chosen name or a neutral per-event `Guest 7`. Only the host desk sees phone numbers.
- **New device → code:** a code is required when a number is already used on another phone. Codes are 6 digits, valid 10 minutes, at most 5 tries, and one can be re-sent after 60 s.
- **Device trust (trade-off):** after a successful sign-in, the phone gets a long-lived httpOnly device cookie. The server stores only a hash, per guest. Re-login on that phone is silent, **including after "Not you?"**. So someone else using *that same phone* could sign in with the previous guest's number without a code. Another phone always needs a code, and a code request alone never makes a device trusted.
- **Hosts:** bcrypt passwords, httpOnly `fl_host_session` cookie, and registration closed after the first owner (`BOOTSTRAP_TOKEN`).
- **Rate limits** on join, code check, bids and host login (see the table). Credentialed CORS is limited to `PUBLIC_URL` / `CORS_ORIGINS`.
- **Payments happen outside the app** (PromptPay, transfer, cash). There is no card processing.
- **Spreadsheet safety:** exported cells starting with `= + - @` are neutralised.

## Theming

The generic look stays in [`web/public/theme.css`](web/public/theme.css) (`:root` / `[data-theme="gala"]`, plus `[data-theme="calm"]`). This checkout is dressed for **Thai.GER Supporters** without replacing those defaults.

The type comes from [thaigersupporters.info](https://thaigersupporters.info): Oswald headings, Inter body, both the theme's own `.woff2` files under `web/public/brand/thaiger/` (SIL Open Font License) so the PWA still works offline. The logo is the file the live header serves, unmodified: [`logo.png`](web/public/brand/thaiger/logo.png), saved from <https://thaigersupporters.info/wp-content/uploads/2025/08/EmbeddedImage.png> (1280×719, the `src` of the site's `.custom-logo`). It is the full mark and wordmark on the file's own white background. The app does not crop, recolor, or redraw it, and does not put a plate behind it. The same file is the favicon and the PWA icon. This checkout dresses every screen — guest, host, big screen and stats — as a dark navy gala with champagne gold (`#D4BC8A` / `#C6A56E`) for the bid, the prices and the raised total. The site red is only the outbid and error colour.

Another event swaps the skin in one place, [`web/src/brand.ts`](web/src/brand.ts):

1. Set `id` to `gala`, `calm`, or a new name, and put that same value on `<html data-theme>` in [`web/index.html`](web/index.html).
2. Point `markSrc` / `lockupSrc` / the icon paths at that event's files (or `""` for no logo), and set `themeColor` / `backgroundColor`.
3. For a new palette, add `web/public/themes/<id>.css` and link it after `theme.css` and before `custom.css`.
4. [`web/public/custom.css`](web/public/custom.css) still loads last. Guest tokens such as `--g-win`, `--g-lose` and `--g-radius` can be overridden there too. Mounting a file over `custom.css` in Docker still works:

```yaml
services:
  web:
    volumes:
      - ./my-brand.css:/usr/share/nginx/html/custom.css:ro
```

```css
:root { --accent: #ff6b9d; --accent-2: #c084fc; --bg: #0a0a12; }
```

Bump `CACHE_ID` in [`web/pwa.options.ts`](web/pwa.options.ts) when you ship new icons or fonts, so installed phones drop the old precache.

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

- API tests use Vitest with `fastify.inject` against a real Postgres. Web tests (Vitest) cover the logic: phone formatting, bid amounts and status, filters, the install hint, the restored code step, cache headers, the service worker strategy and the update/reload kill-switch.
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
