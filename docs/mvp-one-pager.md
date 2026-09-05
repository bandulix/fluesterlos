# FlüsterLos — MVP one-pager

**Product name:** FlüsterLos (ASCII / domains: FluesterLos)  
**Repo:** https://github.com/bandulix/fluesterlos  
**Status:** repo created · 2026-09-05  
**Constraints:** fully open source · self-hosted (Docker-first) · no mandatory cloud

## Problem
Charity and event hosts need live mobile bidding and a clear money board on event night. Existing options are closed SaaS (quote-only suites, % fees, or tip-funded platforms). Hosts who want data custody, predictable cost, and no vendor lock-in are underserved.

## Who it’s for (v1)
- Primary: charity / nonprofit / school / gala **event hosts** and day-of volunteers  
- Secondary: guests bidding on phones via **installable PWA** (QR → add to home screen / open in browser)

## Job to be done (event night)
Guests join in seconds via QR, bid from their phones; **everyone** sees live stats and **timers**; a **big-screen engager** view drives energy and more bids; auction opens/ends on schedule.

## MVP scope (in)
1. **Host setup:** create event, set **scheduled start/end**, add items (title, description, photo, starting bid, min increment, optional buy-now), generate join QR / link; auction **opens and ends automatically** from those settings (manual override optional)  
2. **PWA + frictionless guest join:** scan QR → lightweight registration that is **not a hurdle** (**name + email** only; no phone OTP / verification maze in v1); session sticks on the device  
3. **Guest bidding:** place bids, see current high bid, outbid feedback in-PWA  
4. **Live stats for everyone:** running totals / leaders visible to guests as well as hosts (not host-only)  
5. **Big-screen engager view:** single TV/projector URL — rotating item highlights, live totals, recent bids, soft prompts to scan & bid (ads/sponsor slots if easy)  
5b. **Timers (everywhere that matters):** countdown **until auction starts**; during the auction a countdown **until it ends**; same clocks on PWA + engager; state flips open/closed automatically at the scheduled times  
6. **Self-host:** single `docker compose up`; data on host volumes; config via env / admin  
7. **Auth:** host admin account; guest: name + email only

## Explicitly out of MVP
- Full gala suite (ticketing, table seating, Fund-a-Need, paddle raise)  
- Native App Store / Play apps (PWA is the client)  
- Payment capture / card checkout (record winners + amounts; settle offline or phase 2)  
- Multi-org SaaS tenancy / hosted cloud offering  
- CRM sync (Salesforce etc.)  
- AI item-copy generators

## Success metrics (first pilot)
- Host: empty compose → live bidding in **< 30 minutes** with a checklist  
- Guest: QR → first bid in **< 60 seconds** (including “registration”)  
- 20+ concurrent guests; board / engager updates within a few seconds of each bid  
- CSV export of winners + amounts after close  

## Technical direction (assumptions — challenge freely)
- Monorepo: API + **PWA** (mobile + big-screen route)  
- Realtime: WebSocket or SSE for bids / stats / engager  
- Postgres + local disk or S3-compatible for photos  
- License: **AGPL-3.0** (locked 2026-09-05)  
- Stack TBD when we open the repo  

## Positioning one-liner
> FlüsterLos — open-source, self-hosted silent auction: QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

## Name notes
- German compound: *Flüster* (whisper) + *Los* (auction lot); CamelCase avoids *-los* (“-less”) misread  
- ASCII / GitHub / domains: **FluesterLos** / `fluesterlos`  
- Brand-checked 2026-09-05: low collision (no auction product; no matching GitHub)

## Open decisions
- [x] Final product name: **FlüsterLos**  
- [x] License: **AGPL-3.0**  
- [x] Guest identity: name + email (no OTP)  
- [ ] Payments in v1.1 or never in core  
- [x] GitHub: **public** (`bandulix/fluesterlos`)  
- [ ] Sponsor/ad slots on engager in v1 vs later  

## Next after this doc
1. ~~Create GitHub repo~~ → https://github.com/bandulix/fluesterlos  
2. First vertical slice: QR join → bid → public stats → engager
