# FlüsterLos

Open-source, self-hosted **silent auction** for charity and event hosts.

> QR → PWA → bid; everyone sees the live board — and the big screen keeps the room bidding.

**License:** [AGPL-3.0](./LICENSE)
**Status:** first vertical slice — create event, QR join, bid, live stats, engager

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

## Quickstart

1. Copy env: `cp .env.example .env`
2. Start stack: `docker compose up --build`
3. Open **Host UI** at http://localhost:8080/host — use `HOST_TOKEN` from `.env` (default `dev-host-token-change-me`), create event + items, share QR / join link
4. Guest joins at `/e/<code>` (name + email only), then bids at `/e/<code>/bid`
5. Public stats: `/e/<code>/stats` — Engager big screen: `/e/<code>/engager`

API also on http://localhost:3000 (`/api/health`).

## Stack (this slice)
- API: Node.js + Fastify + Postgres + SSE
- Web: Vite + React + TypeScript PWA
- Compose: `api` + `web` (nginx) + `db` (postgres:16)

## Out of MVP
Gala suite (ticketing / tables / Fund-a-Need), native store apps, card checkout, multi-tenant SaaS, CRM, AI copy.

## Docs
See [`docs/mvp-one-pager.md`](./docs/mvp-one-pager.md).

## Name
*Flüster* (whisper) + *Los* (auction lot). ASCII: **FluesterLos** / `fluesterlos`.
