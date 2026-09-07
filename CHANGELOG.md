# Changelog

All notable changes to FlüsterLos are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project versions toward [SemVer](https://semver.org/).

## [Unreleased]

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
