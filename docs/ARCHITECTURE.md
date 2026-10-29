# Architecture

A **modular monolith**: one Next.js (App Router) application containing the UI, HTTP API and domain services, backed by one PostgreSQL database. No microservices until real load justifies them.

```
Browser ──HTTPS──► proxy.ts (request id, CSP nonce, optimistic auth redirect)
                     │
        ┌────────────┴─────────────┐
   Pages (RSC)                Route handlers (/api/*)
        │   authed() wrapper: session → actor, MFA policy, same-origin check, error mapping
        └────────────┬─────────────┘
               Services (src/server/services/*)  ← single place for authorization + business rules
                     │   Zod validation · permission checks · transactions · audit · outbox
               Prisma (driver adapter: pg) ──► PostgreSQL
                                                 │ outbox trigger → pg_notify (on commit)
               Realtime hub (LISTEN) ◄───────────┘
                     │
               /api/events (SSE) ──► dashboards (router.refresh on change)
```

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Pure domain rules | `src/features/*/rules.ts`, `schema.ts` | Status transitions, ID validity, verification decision, Zod schemas shared by forms and server. No I/O |
| Authorization | `src/server/authorization/permissions.ts` | Role → permission map, grantable extras, deny-by-default `can()` |
| Services | `src/server/services/*` | Every read/write. Each function takes `(db, actor, input, ctx)`, checks permission, validates, runs a transaction, writes audit + outbox rows |
| HTTP | `src/app/api/**`, `src/server/http/api.ts` | Thin handlers: parse, call service, serialize. Body-size limits, CSRF origin check, safe error responses |
| Auth | `src/server/auth/*` | Better Auth (email + password, TOTP plugin), Argon2id hashing, session → `Actor` resolution re-reading role/status from the DB on every request |
| Realtime | `src/server/realtime/hub.ts`, `/api/events` | Per-process hub that LISTENs on PostgreSQL and fans out to SSE clients |
| UI | `src/app/(public|auth|dashboard)`, `src/components/*` | Server components fetch through services; client components call the API |

UI components never touch the database; client-side permission checks only hide buttons.

## Key flows

**Create employee.** `POST /api/employees` → `createEmployee()` → permission `employee:create` → Zod (strict, unknown keys rejected) → transaction: allocate the next code with an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `employee_code_counter`, insert the employee, append audit, append outbox → commit → PostgreSQL delivers `NOTIFY` → hub → SSE → connected dashboards refresh.

**Issue QR.** `POST /api/employees/:id/credentials` → transaction: revoke any live credential, create a new one with `sha256(token)` for lookup and `AES-256-GCM(token)` so HR can re-display the QR. A partial unique index guarantees at most one live credential per employee. Employment status is never changed by issuance.

**Verify.** `GET /verify/:token` (page) or `/api/verify/:token` (JSON) → per-client rate limit → format check → hash lookup → `verificationOutcome()` (revoked > inactive/archived > ID expired > credential expired > verified) → allow-listed public fields only (filtered by System Rules) → `VerificationEvent` with a keyed IP hash. Responses are `no-store`, `no-referrer`, `noindex`.

## Real-time design

- **Transactional outbox**: events are rows written in the same transaction as the change; a trigger calls `pg_notify`, which PostgreSQL delivers only after commit. Rolled-back changes never emit (covered by tests).
- **Cross-instance**: every app instance LISTENs to the same database, so no in-memory bus is shared between processes. A 5-second poll covers LISTEN outages (e.g. behind a transaction-mode pooler — set `DATABASE_DIRECT_URL`).
- **Minimal payloads**: `{type, at, employeeId?, credentialId?}` plus a required permission (`scope`). Clients re-fetch authorized data (`router.refresh()`), so a forged or stale event can't show unauthorized data.
- **Reliability**: SSE `id` = outbox id; reconnecting clients send `Last-Event-ID` and receive up to an hour of missed events (or a `resync`). Heartbeats every 20 s, session re-check every 60 s, client- and server-side de-duplication, recovery from outbox sequence resets.

## Decisions

| Decision | Why |
| --- | --- |
| Next.js 16 + Route Handlers, no separate API server | One deployable; RSC pages call services directly |
| `cacheComponents` off, all pages dynamic | Every page is per-user; a per-request CSP nonce requires dynamic rendering |
| Webpack build (`--webpack`) | Turbopack's CSS worker could not spawn under the restricted Windows dev environment; webpack is equally supported and builds identically on Linux |
| Better Auth | Maintained, supports Next 16, Prisma adapter, TOTP, DB-backed rate limits; password hashing overridden with Argon2id |
| Token encrypted *and* hashed | Hash for lookup; ciphertext so HR can re-print a QR without reissuing. Discarded on revocation |
| Offset pagination for the directory, keyset for the audit log | Directory needs "page N of M" and arbitrary sorts; the audit log is append-only and grows without bound |
| SSE over WebSockets | Server → browser only; works through standard HTTP infrastructure |
| PostgreSQL LISTEN/NOTIFY instead of Redis | No extra service at this scale; a pub/sub service can replace the hub later without changing the event schema |
