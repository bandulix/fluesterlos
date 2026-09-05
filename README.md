# FlüsterLos

Open-source, self-hosted **silent auction** for charity and event hosts.

> QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE)  
**Status:** greenfield — first vertical slice in progress

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

## Out of MVP
Gala suite (ticketing / tables / Fund-a-Need), native store apps, card checkout, multi-tenant SaaS, CRM, AI copy.

## Docs
See [`docs/mvp-one-pager.md`](./docs/mvp-one-pager.md).

## Name
*Flüster* (whisper) + *Los* (auction lot). ASCII: **FluesterLos** / `fluesterlos`.
