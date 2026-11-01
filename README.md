# Sania Employee Identity & Verification Platform

**Sania Job Bowl** — *Connecting Talent. Creating the Future.*

A full-stack web application for managing employee records and issuing a unique, revocable QR credential to each employee. Anyone can scan the QR to see the **current** status of that employee record; owners and HR staff manage everything from a restricted, real-time dashboard.

> "Live monitoring" here means live **record status** (active / inactive / revoked) pushed to HR dashboards in real time. The system does not track employee location, devices or online presence.

| Area | What it does |
| --- | --- |
| HR dashboard | Directory with server-side search, filters, sort and pagination; add/edit; deactivate/reactivate/archive; **delete (single or bulk)**; bulk status changes; CSV import/export; live updates across sessions |
| Duplicate cleanup | Import can skip employees that already exist; the Import page lists duplicate records (e.g. a CSV uploaded twice) and removes the extra copies in one click, keeping one per person |
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

## Removing employees

Owners and HR Administrators (permission `employee:delete`) can permanently delete employee records:

- **Directory (Dashboard):** the trash icon on a row deletes that employee. Tick several rows (or the header checkbox for the whole page) and use **Delete** in the bulk bar to remove many at once.
- **Employee profile:** **Delete** next to the status actions.
- **Bulk import page → Duplicate employees:** if the same CSV was uploaded twice, matching records are grouped here. **Remove N duplicates** deletes every extra copy in one step (up to 1,000 per click) and keeps one record per person — the one with a QR credential, otherwise the oldest. Each group also has its own **Remove copy** button.
- **Prevent duplicates:** the import form's **Skip employees that already exist** option (on by default) ignores rows that match an existing record or an earlier row in the same file.

Deletion asks for a reason, is all-or-nothing, removes the employee's QR credentials (printed QRs then show *Invalid*) and is recorded in the append-only audit log. It cannot be undone — use **Archive** if the record may be needed later. Records match as duplicates when name, department, job title, business vertical, location, joining date, phone and work email are all equal (ignoring case and extra spaces).

API: `POST /api/employees/delete` with `{ "ids": [...], "reason": "..." }`; `GET /api/employees/duplicates`; `POST /api/employees/import?skipDuplicates=1`.

### Logo

Put the logo at `public/branding/sania-job-bowl-logo.png` (PNG, square, ideally 256×256 or larger, transparent background). It is picked up automatically (restart the server, or commit and push to redeploy); until then a neutral placeholder is shown. To change the browser-tab icon too, replace `src/app/favicon.ico` (or add `src/app/icon.png`).

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
- [Project report (PDF)](docs/Project-Report.pdf) — full project overview: features, architecture, security, testing, deployment

## Status

Running as a **free-tier trial**: the app on **Render** (Blueprint in `render.yaml`) and PostgreSQL on **Neon**. Every push to `main` redeploys automatically; migrations run on start (`npm run start:prod`). Paid hosting and a custom domain still require the owner's approval — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
