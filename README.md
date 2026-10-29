# Sania Employee Identity & Verification Platform

**Sania Job Bowl** — *Connecting Talent. Creating the Future.*

A full-stack web application for managing employee records and issuing a unique, revocable QR credential to each employee. Anyone can scan the QR to see the **current** status of that employee record; owners and HR staff manage everything from a restricted, real-time dashboard.

> "Live monitoring" here means live **record status** (active / inactive / revoked) pushed to HR dashboards in real time. The system does not track employee location, devices or online presence.

| Area | What it does |
| --- | --- |
| HR dashboard | Directory with server-side search, filters, sort and pagination; add/edit; deactivate/reactivate/archive; bulk status changes; CSV import/export; live updates across sessions |
| QR credentials | Issue, preview, copy, print, reissue and revoke. Each QR holds only an opaque 256-bit token |
| Public verification | `/verify/<token>` shows company-approved fields and an explicit state: Verified — Active, Inactive, ID expired, Credential expired, Revoked, Invalid, or Unavailable |
| Access control | Owner / HR Administrator / HR Staff roles plus individually grantable permissions, enforced on the server |
| Security | Argon2id passwords, TOTP MFA (enforceable for privileged roles), DB-backed rate limits, CSP with nonces, CSRF origin checks, append-only audit log |

## Quick start (local development)

Requirements: **Node.js 22+** (tested on 24). No Docker needed — a local PostgreSQL runs from npm.

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then generate secrets as described inside the file
npm run db:start            # terminal 1: local PostgreSQL on port 5433 (leave running)
npm run db:deploy           # terminal 2: apply migrations
npm run db:seed             # fictional demo data; prints demo logins
npm run dev                 # http://localhost:3000
```

The seed prints three **local-only** accounts (Owner, HR Admin, HR Staff) with random passwords. MFA enforcement is switched off in the local seed only; turn it on under **System Rules**.

### Logo

Put the official logo at `public/branding/sania-job-bowl-logo.png`. It is picked up automatically (restart the server); until then a neutral placeholder is shown.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` / `build` / `start` | Next.js development server, production build, production server |
| `lint`, `typecheck` | ESLint, TypeScript (`strict`) |
| `test`, `test:watch`, `test:coverage` | Vitest unit + integration (+ coverage). Integration tests use the `sania_test` database |
| `test:e2e` | Playwright end-to-end tests against a production build and an isolated `sania_e2e` database |
| `db:start` | Local PostgreSQL (development only) |
| `db:generate`, `db:migrate`, `db:deploy` | Prisma client generation, create migration (dev), apply migrations |
| `db:seed`, `db:reset` | Demo seed / reset — both refuse to run against non-local databases |
| `seed:load`, `load-test` | Load-test dataset and runner (see `docs/TESTING.md`) |
| `owner:create` | Bootstrap the first Owner on a fresh production database |
| `maintenance:retention` | Daily retention job (audit, verification events, outbox, expired sessions) |

On Windows with little space on C:, set `PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright` before `npx playwright install chromium` and `npm run test:e2e`. The project `.npmrc` keeps the npm cache on D:.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flows, trust boundaries, decisions
- [Data model](docs/DATA_MODEL.md) — tables, statuses, ID generation, retention
- [Security](docs/SECURITY.md) — threat model, mitigations, residual risks
- [Testing](docs/TESTING.md) — test strategy, results, measured load figures, implementation checklist
- [Deployment](docs/DEPLOYMENT.md) — hosting comparison, recommended plan, domain options, runbooks

## Status

**Nothing is deployed yet.** Production hosting, the production database and the domain require the owner's explicit approval — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
