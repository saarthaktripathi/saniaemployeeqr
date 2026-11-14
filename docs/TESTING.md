# Testing

All numbers below were measured on the development machine (load figures on **2026-10-29**; functional suites re-run on **2026-11-14** for the workforce release). Nothing is extrapolated.

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
| Vitest | **222 / 222 passed** (18 files; workforce: 10 account/RLS, 17 attendance, 12 task/leave/notification integration tests, 2 readiness-probe tests and 13 attendance-rule unit tests). The 127 integration and security tests also pass connected as a Neon-style **non-superuser** owner (rehearsal, 2026-11-15) |
| Coverage (all server/feature/lib code) | Statements 88.9%, Branches 76.2%, Functions 90.4%, Lines 93.6% |
| Coverage — workforce services | Lines: attendance 97.6, tasks 99.0, accounts 100, notifications 100, leave 93.8, attendance-hr 92.1, team 91.7, rules/schemas 100 |
| Coverage — services | Lines 81–100% per file (employees 99.7, companies 97.9, compensation 100, documents 100, history 100, credentials 100, audit 100, verification 81.0, users 90.6) |
| Coverage — permissions / rate limiting | 100% lines |
| `npm run build` | pass (all routes dynamic) |
| Playwright | **43 / 43 passed** (31 existing + workforce: employee workspace and blocked HR console/APIs, punch in/out with live HR KPI update, sign-out guard, missed punch-out resolution, correction request → apply, task assign → start → submit → approve, leave apply → approve, team manager scope, invitation → password → login, 22 new pages at 375 px) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Migration drift (`prisma migrate diff`) | no difference |

Lower-covered files are Better Auth glue (`server/auth/auth.ts`, `session.ts`): exercised by the e2e suite rather than unit tests.

### End-to-end coverage (maps to the required flows)

Workforce: employee login lands on `/me` · HR pages and HR APIs refused to employees (redirect / 403) · punch in → HR "Currently working" KPI changes **live** → duplicate punch-in rejected (409) and client timestamps rejected (422) → sign-out guard → punch out · HR resolves a missed punch-out (audited before/after) · employee correction request → HR applies → employee sees "Approved" · task created with the people picker → employee starts and submits → HR approves → completed view + unread notification · leave applied → HR approves → status updates · team manager sees the team, cannot assign departments · invitation link single-use, password set, login lands in the workspace.

Directory and verification: Owner login · wrong-password generic error · anonymous redirect + 401 APIs/SSE · HR Staff read-only (UI hidden **and** direct API 403, `/settings` and `/users` forbidden) · HR Admin limits · create → edit → issue QR → public verify → deactivate (verify shows Inactive) → reactivate → revoke (verify shows Revoked) · expired ID never shows Verified · unknown/malformed tokens · search by name/ID, pagination, empty state · audit log visibility incl. sign-ins · **live update across two browser sessions without reload** · sign-out + old-cookie replay rejected · mobile 375 px no horizontal overflow · skip link + focus · security headers.

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
8. (Workforce) Workspace roles could hold extra permissions if any were stored on the account — workspace roles now ignore extra grants.
9. (Workforce) On the filtered "No login" list the one-time invitation link vanished before it could be copied — the list now refreshes after the link dialog closes.
10. (Workforce) Correction dialogs reused element ids, so labels pointed at hidden fields (accessibility) — ids are now unique per dialog.

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
- [x] CI workflow
- [x] Official logo asset
- [x] Free-tier deployment (Render + Neon); custom domain, paid backups awaiting owner approval
- [x] Group employee directory (companies, Management role, employment details, reporting lines, exit + history, compensation, documents)
- [x] Workforce management: employee logins (invitations, reset links), employee workspace, attendance, corrections, tasks, leave, notifications, announcements, row-level security
- [ ] Email delivery of invitations/resets/notifications — links are shared manually for now (no email provider)
- [ ] External penetration test
