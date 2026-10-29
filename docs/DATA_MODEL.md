# Data model

Source of truth: `prisma/schema.prisma` and `prisma/migrations/`. Hand-written SQL in the first migration adds constraints Prisma can't express.

## Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit` | Better Auth tables | `user.role` (`OWNER`/`HR_ADMIN`/`HR_STAFF`), `isActive`, `extraPermissions`. Password hashes (Argon2id) live in `account.password` |
| `employee` | Employee records | UUID PK; immutable unique `employeeCode`; optimistic `version`; `archivedAt` |
| `employee_code_counter` | Per (prefix, year) sequence | Atomic upsert allocates codes |
| `employee_credential` | QR credentials | `tokenHash` (unique), `tokenCiphertext`, `expiresAt`, `revokedAt`, `revokeReason` |
| `audit_log` | Append-only audit trail | UPDATE/DELETE blocked by trigger |
| `verification_event` | Public verification analytics | Result + keyed IP hash, retention-limited |
| `outbox_event` | Real-time outbox | `pg_notify` trigger on insert; purged after 7 days |
| `company_settings` | Singleton (id = 1) | System Rules |
| `app_rate_limit` | Fixed-window counters | Verification, creation, issuance, bulk, export |

## Status definitions

Three independent dimensions. "Active" never means "online" or "present": the system does **no** presence, location or device tracking.

| Dimension | Values | Meaning |
| --- | --- | --- |
| Employment status | `ACTIVE`, `INACTIVE` | Whether the person is currently employed / authorized. Changed only by explicit HR action |
| Archival | `archivedAt` null / set | Record retired (left the company). Hidden from the directory, forced `INACTIVE`, live credential revoked. History kept |
| ID validity (derived) | `VALID`, `EXPIRING_SOON`, `EXPIRED` | From `idExpiresAt`, inclusive of the expiry date (UTC). "Soon" = within `expiryWarningDays` |
| Credential state (derived) | `VALID`, `EXPIRED`, `REVOKED`, `NONE` | Per credential; credential expiry is independent of ID expiry |

Allowed transitions: `ACTIVE → INACTIVE` (deactivate), `INACTIVE → ACTIVE` (reactivate), any non-archived → archived (archive), archived → `INACTIVE` non-archived (unarchive; never auto-reactivates).

## Employee IDs

Format `PREFIX-YEAR-NNN`, e.g. `SJB-2026-001` (zero-padded to 3 digits, grows to 4+ beyond 999).

- The **sequence resets every calendar year (UTC)**, and is separate per prefix.
- Allocation is `INSERT … ON CONFLICT (prefix, year) DO UPDATE SET lastValue = lastValue + 1 RETURNING lastValue` inside the employee-creation transaction. The row lock serializes concurrent creators. A rolled-back transaction never issued its code, so no committed code is ever reused.
- `employeeCode` has a unique constraint; on a collision (only possible if codes were inserted outside the counter) creation retries up to 3 times.
- Codes never change after creation, even if the prefix setting changes.
- Verified by a 40-way concurrent-creation integration test and a 25-way concurrent HTTP load test.

## Uniqueness and integrity

- Work email: unique case-insensitively when present (`lower("workEmail")` partial unique index).
- At most one non-revoked credential per employee (partial unique index).
- `idExpiresAt >= idIssueDate` (check constraint).
- Foreign keys: credentials → employee `RESTRICT` (no deleting history); audit/verification → user/employee `SET NULL`.

## Indexes

Employee: `employeeCode` (unique), `employmentStatus`, `department`, `idExpiresAt`, `archivedAt`, `(createdAt, id)`, `displayName`, plus `lower(displayName)` and `lower(employeeCode)` pattern indexes. Credentials: `tokenHash` (unique), `(employeeId, issuedAt)`, `expiresAt`. Audit: `createdAt`, `(targetType, targetId, createdAt)`, `(actorId, createdAt)`, `(action, createdAt)`.

Name search uses `ILIKE '%term%'` (LIKE wildcards escaped). Measured p95 ≈ 100 ms at 10,000 records under load. For 100k+ records, add a `pg_trgm` GIN index on `displayName`.

## Personal data and retention

Collected: name, optional work email and phone (private, never public, never exported: phone), department, job title, business vertical, work location, dates. No photos, no government IDs, no location data.

| Data | Retention (configurable in System Rules) |
| --- | --- |
| Audit log | 730 days (min 90). Purge only via `npm run maintenance:retention`, which opts in per transaction |
| Verification events | 90 days |
| Outbox events | 7 days |
| Expired sessions / tokens | Removed by the retention job |
| Employee records | Kept until archived. Hard deletion is intentionally not exposed. Define a legal retention period before adding it |
