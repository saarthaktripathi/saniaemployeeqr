# Testing

All numbers below were **measured on 2026-10-29** on the development machine. Nothing is extrapolated.

## Suites

| Suite | Tool | Location | Database |
| --- | --- | --- | --- |
| Unit (rules, permissions, validation, crypto, CSV, logging, HTTP wrapper) | Vitest | `tests/unit` | none |
| Integration (services, constraints, concurrency, audit, real-time hub) | Vitest | `tests/integration` | `sania_test` (migrated automatically; refuses non-test URLs) |
| End-to-end (browser) | Playwright + Chromium | `tests/e2e` | `sania_e2e`, recreated and seeded each run; runs against `next start` (production build) |
| Load / concurrency | Custom Node runner (no extra deps) | `tests/load` | `sania_load` |

Run: `npm run db:start` (separate terminal), then `npm test`, `npm run test:coverage`, `npm run build && npm run test:e2e`.

## Latest results

| Check | Result |
| --- | --- |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run typecheck` | pass |
| Vitest | **100 / 100 passed** (9 files) |
| Coverage (all server/feature/lib code) | Statements 83.2%, Branches 73.9%, Functions 80.1%, Lines 87.1% |
| Coverage — services | Lines 88–100% per file (employees 95.5, credentials 100, audit 100, verification 80, users 90.6) |
| Coverage — permissions / rate limiting | 100% lines |
| `npm run build` | pass (all routes dynamic) |
| Playwright | **18 / 18 passed** |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Migration drift (`prisma migrate diff`) | no difference |

Lower-covered files are Better Auth glue (`server/auth/auth.ts`, `session.ts`): exercised by the e2e suite rather than unit tests.

### End-to-end coverage (maps to the required flows)

Owner login · wrong-password generic error · anonymous redirect + 401 APIs/SSE · HR Staff read-only (UI hidden **and** direct API 403, `/settings` and `/users` forbidden) · HR Admin limits · create → edit → issue QR → public verify → deactivate (verify shows Inactive) → reactivate → revoke (verify shows Revoked) · expired ID never shows Verified · unknown/malformed tokens · search by name/ID, pagination, empty state · audit log visibility incl. sign-ins · **live update across two browser sessions without reload** · sign-out + old-cookie replay rejected · mobile 375 px no horizontal overflow · skip link + focus · security headers.

## Load and concurrency (measured)

**Environment:** Windows 11 laptop; Node 24.14; PostgreSQL 18 (embedded) and the app (`next start`, one process, pool 10) and load generator all on the same machine. Concurrency 20 connections; 15 s per scenario at 10k, 10 s at 1k/100. Authenticated scenarios use one owner session; verification uses randomized `X-Forwarded-For` to model many distinct verifiers.

| Scenario | 100 employees p50 / p95 / p99 (ms) | 1,000 | 10,000 | Throughput @10k | Errors |
| --- | --- | --- | --- | --- | --- |
| Directory page (random page 1–20) | 79 / 101 / 118 | 86 / 104 / 117 | 88 / 115 / 142 | 218 req/s | 0% |
| Search by name (`ILIKE`) | 82 / 92 / 101 | 80 / 94 / 105 | 86 / 100 / 108 | 231 req/s | 0% |
| Search by employee ID | 80 / 96 / 104 | 76 / 88 / 98 | 82 / 96 / 103 | 241 req/s | 0% |
| Filter + sort (status, dept, expiry) | 83 / 98 / 114 | 80 / 93 / 102 | 84 / 102 / 110 | 234 req/s | 0% |
| Dashboard aggregates | 77 / 93 / 103 | 72 / 85 / 92 | 85 / 111 / 124 | 231 req/s | 0% |
| Public verification, valid token | 47 / 62 / 83 | 47 / 60 / 67 | 44–64 / 52–116 / 61–140¹ | 289–449 req/s | 0% |
| Public verification, unknown token | 49 / 59 / 67 | 45 / 53 / 60 | 44–56 / 52–82 / 61–91¹ | 340–447 req/s | 0% |
| 25 concurrent employee creations (HTTP) | 168 ms total | 166 ms | 195–271 ms | — | 0%, **25/25 unique codes** |
| SSE fan-out (1 change → 50 clients) | 50/50, p95 11.7 ms | 50/50, p95 11.8 ms | 50/50, p95 17–19 ms | — | — |

¹ Range across two 10k runs on the same machine (background load differed).

**Observations / bottlenecks**

- Authenticated requests cost ~75–90 ms p50 regardless of dataset size: dominated by per-request session validation plus fresh role lookup (deliberate, for instant revocation) and settings reads, not by the employee queries. If needed: cache settings for a few seconds and use Better Auth's signed cookie cache (trade-off: revocation delay).
- Dataset size from 100 → 10,000 changed directory p95 by ~15 ms. Beyond ~100k rows, add `pg_trgm` for substring name search and consider keyset pagination for deep pages.
- The local single-process setup saturates CPU before the database; production capacity depends on the chosen instance size and must be re-measured there.
- Login rate limiting (5/min/IP) is intentionally not load-tested.

**Targets** (proposed, not yet validated on production hardware): directory p95 < 300 ms and verification p95 < 200 ms at 10k employees, error rate < 0.1%.

Raw JSON results: `tests/load/results/load-*.json` (git-ignored; regenerate with `npm run seed:load` + `npm run load-test`).

## Defects found by testing and fixed

1. LIKE wildcards (`%`, `_`) in directory search matched everything — now escaped.
2. Employee form submitted resolver-transformed `Date` objects, which the server's `YYYY-MM-DD` validator rejected — form now submits raw values.
3. Static prerendered pages could not carry the CSP nonce (scripts would be blocked in production) — all pages rendered per request.
4. Real-time hub replayed pre-existing outbox events to the first subscriber — baseline added.
5. Hub dropped events after an outbox sequence reset (e.g. DB restore) — reset detection and id+timestamp de-duplication.
6. Build failed when `DATABASE_URL` was absent — Prisma client now created lazily.
7. Tailwind was not compiled after a config change — switched to the PostCSS plugin.

## Implementation checklist

- [x] Auth (Better Auth, Argon2id, TOTP MFA, session revocation, rate limits)
- [x] Roles + grantable permissions, enforced server-side
- [x] Employee CRUD, search/filter/sort/pagination, lifecycle, archive, bulk status, CSV import/export
- [x] Concurrency-safe employee IDs
- [x] QR credentials: issue, preview, print, reissue, revoke, expiry
- [x] Public verification with all states
- [x] Real-time dashboard (outbox + LISTEN/NOTIFY + SSE)
- [x] Append-only audit log with role-filtered viewer
- [x] System Rules, Users & Access, Account Security pages
- [x] Security headers/CSP, CSRF, input limits, data minimization
- [x] Unit, integration, e2e, security-regression, load tests
- [x] CI workflow (not yet run on GitHub — no remote push made)
- [ ] Official logo asset (placeholder in use)
- [ ] Production deployment, domain, backups (awaiting owner approval)
- [ ] Email flows (password reset) — not implemented; owner resets passwords
- [ ] External penetration test
