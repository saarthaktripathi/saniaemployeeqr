# Architecture audit (Phase 1)

Audit of the existing Sania Job Bowl application before extending it into a workforce management platform (attendance, tasks, leave, notifications, employee self-service). Date: 2026-11-14. Baseline commit: `ff0a24c` (live).

## 1. Stack

| Layer | What is used | Notes |
| --- | --- | --- |
| Framework | **Next.js 16.4** (App Router, `--webpack`), React 19, TypeScript strict | Route handlers receive async `params`; `src/proxy.ts` replaces middleware |
| Styling | Tailwind CSS v4, own UI kit in `src/components/ui` | Navy sidebar, purple/indigo accents, pastel page banners |
| Database | **PostgreSQL** (Neon in production, embedded-postgres locally on port 5433) | Prisma 7 with the `pg` driver adapter; client generated to `src/generated/prisma` |
| Auth | **Better Auth** (email + password, Argon2id, TOTP two-factor plugin) | Public sign-up disabled; accounts created by owners; 8 h sessions; DB-backed rate limits |
| Real-time | Transactional **outbox → `pg_notify` → in-process hub → Server-Sent Events** | Clients receive ids only and call `router.refresh()` |
| Validation | Zod v4 strict schemas in `src/features/**/schema.ts` | Absent key = unchanged; `""`/null = clear |
| Tests | Vitest (unit, components, integration on a real Postgres DB) + Playwright e2e | 165 Vitest + 31 e2e passing locally at baseline |
| Hosting | Render free web service + Neon free Postgres; `render.yaml`; migrations run at start | Push to `main` auto-deploys |

**Not used:** Supabase (Auth, Realtime, RLS helpers). The brief's "continue with Supabase if present" does not apply: this project uses Better Auth + Prisma + plain PostgreSQL. The new modules therefore continue with the existing stack. Row-level security is implemented natively in PostgreSQL (see `DATABASE_DESIGN.md` §3) instead of through Supabase.

## 2. Structure

```
src/
  app/(auth)/login            sign-in page
  app/(dashboard)/…           HR console: directory, employee profile/edit/ID card, import, activity,
                              companies, system rules, users & access, account security
  app/(public)/verify/[token] public QR verification page
  app/api/…                   JSON route handlers (all wrapped by `authed()` except health/ready/verify/auth)
  components/…                UI by domain (employees, dashboard, layout, ui primitives, verification…)
  features/…/schema.ts        Zod input schemas shared by API and forms
  server/auth                 Better Auth instance, session → Actor resolution, request context
  server/authorization        permission model (pure module; deny by default)
  server/services             business logic — every function takes (db, actor, input, ctx)
  server/realtime/hub.ts      LISTEN/poll fan-out to SSE subscribers
  server/security             crypto helpers, DB-backed rate limiter
prisma/                       schema, hand-reviewed migrations, seed
tests/                        unit, integration, e2e, load
```

## 3. Request pipeline and security model

1. `proxy.ts`: request id, per-request CSP nonce, optimistic redirect to `/login` when no session cookie (cosmetic, not authorization).
2. Route handlers use `authed()` (`server/http/api.ts`): same-origin check for mutations (CSRF), session → `Actor` (role, `isActive`, extra permissions re-read from the DB on every request), MFA policy, error mapping (no internals leaked).
3. Services call `authorize(db, actor, permission, ctx)`. Denials are audited (`authz.denied`). Writes run in a transaction that also writes the audit row and an outbox event.
4. Pages call `requirePageActor(permission)`; menus are filtered for convenience only.

Strengths: deny-by-default permissions, server-side enforcement in services, append-only audit log (trigger), strict schemas, CSRF origin check, DB-backed rate limits, careful data minimisation in public/real-time payloads.

## 4. Existing modules (all preserved)

| Module | Where | Status |
| --- | --- | --- |
| Employee directory (search, filters, sort, pagination, CSV export, bulk actions) | `/dashboard`, `services/employees.ts` | Working |
| Employee create/edit/profile (photo, company, reporting manager, history, documents, compensation) | `/employees/*` | Working |
| QR credentials + public verification + ID cards | `services/credentials.ts`, `verification.ts`, `/verify/[token]` | Working; must not regress |
| Companies (group) | `/companies` | Working |
| System rules (`company_settings`, single row) | `/settings` | Working |
| Activity log (audit) | `/activity` | Working |
| Users & access (HR accounts, roles, extra permissions) | `/users` | Working |
| Header "notifications" | `components/layout/notifications.tsx` | Shows recent **audit activity**, not personal notifications; HR only |
| Real-time | `/api/events` | Requires `dashboard:read` — employees could not subscribe today |

Roles today: `OWNER`, `HR_ADMIN`, `HR_STAFF`, `MANAGEMENT`. All accounts are HR/leadership accounts; **no employee has a login**, and `user` rows are not linked to `employee` rows.

Attendance and leave exist only as *reference fields* on the employee (`attendanceRef`, `leavePolicy`, `leaveSystemUrl`). There is no task, leave, attendance or notification data model.

## 5. Gaps relevant to the new brief

1. **No employee identity link** — needs `user.employeeId` (unique) so every employee login maps to exactly one existing employee record.
2. **No invitation / password-reset flow** and **no email provider**. Invitations and resets must work without email for now (single-use, expiring links that HR hands over), with email delivery as a later add-on.
3. **Real-time stream is HR-only** and events are filtered by permission only; user-targeted events (personal notifications, own attendance) need per-user delivery.
4. **No scheduler** on the free tier (Render cron is paid). Deadline reminders and incomplete-session alerts must be computed opportunistically (on use) plus an optional daily maintenance command.
5. **No database-level row security.** Authorization is enforced only in services. The brief requires RLS as a second layer for the new employee-facing data.
6. **Time zones:** existing timestamps are `timestamp(3)` holding UTC written by Prisma; the local dev database runs in `Asia/Calcutta` with WIN1252 encoding (migrations must stay ASCII and avoid server-local `now()` in data backfills). Attendance needs explicit UTC storage (`timestamptz`) and organisation-time-zone day boundaries.
7. **Excel export:** only an Excel *reader* (`read-excel-file`) is installed; exports are CSV. A small built-in XLSX writer avoids a new dependency.

## 6. Risks and known issues found

| # | Finding | Impact | Plan |
| --- | --- | --- | --- |
| R1 | GitHub CI "End-to-end tests" step fails on every run since before the directory feature; the same suite passes locally (31/31). Logs need GitHub auth. | CI signal is red; deploys are not gated by CI (`autoDeployTrigger: commit`) | Keep e2e deterministic (no wall-clock or locale assumptions); ask the owner for CI log access to fix the root cause |
| R2 | `getCredentialPreview` throws if a stored token cannot be decrypted (only after a key change) → profile page error | Low | Out of scope; documented |
| R3 | Free tier: Render sleeps after 15 min idle (≈1 min cold start); Neon free has 100 compute-hours/month | Morning punch-ins after a quiet night may wait ~1 min; all-day employee dashboards keep Neon awake longer | Deployment readiness report recommends the paid Render plan before employees depend on attendance |
| R4 | Neon's owner role is not a superuser. The RLS design switches to a dedicated role inside transactions; granting the owner the right to `SET ROLE` must be verified on Neon | Migration could fail on Neon if the grant is not permitted | Migration is defensive; readiness report requires a dry run on a **Neon branch** before production |
| R5 | `audit_log` purge and immutability rely on table ownership | As documented in SECURITY.md | Same pattern for the new immutable attendance/task event tables |

## 7. Reuse decisions

- **Identity:** Better Auth stays. Employees get ordinary Better Auth accounts (same Argon2id hashing, rate limits, session handling, optional TOTP). No second user store, no second employee table.
- **Authorization:** extend `permissions.ts` (new roles + permissions) and keep services as the enforcement point; add RLS underneath.
- **Real-time:** extend the existing outbox/SSE pipeline (per-user audience) instead of adding a new channel.
- **Files:** task attachments reuse the document upload pattern (magic-byte sniffing, size limit, DB blob store behind an interface).
- **UI:** reuse `PageHeader`, `Card`, `Badge`, `Button`, `Field`, `ConfirmDialog`, sidebar/nav, avatar and photo components; the employee workspace reuses the same layout shell with its own navigation.
- **Audit:** every new mutation writes to the existing append-only `audit_log`.
