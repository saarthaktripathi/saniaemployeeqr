# Data model

> **Workforce management (2026-11-14):** attendance, tasks, leave, notifications, employee logins and row-level security are documented in [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

Source of truth: `prisma/schema.prisma` and `prisma/migrations/`. Hand-written SQL in the first migration adds constraints Prisma can't express.

## Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit` | Better Auth tables | `user.role` (`OWNER`/`HR_ADMIN`/`HR_STAFF`/`MANAGEMENT`), `isActive`, `extraPermissions`. Password hashes (Argon2id) live in `account.password` |
| `company` | Companies of the Sania group | `name` (unique case-insensitively), optional `code`, `isActive`. Employees reference it with `RESTRICT`, so a company with records can't be deleted (mark it inactive instead) |
| `employee` | Employee records | UUID PK; immutable unique `employeeCode`; optimistic `version`; `archivedAt`; `companyId`; `employmentType`, `workMode`, `team`; `reportingManagerId` (self-reference, `SET NULL` on delete, never the employee itself, loops rejected by the service); `attendanceRef`, `leavePolicy`, `leaveSystemUrl` (references only); `exitDate` + `exitType` + `exitReason` (all null unless an exit is recorded — check constraint); `photoKey` + `photoUpdatedAt` (storage reference and cache-busting stamp for the profile photo) |
| `employment_history` | Career timeline | Automatic entries (joined, designation/department/company/manager/type/mode/location change, exited, rejoined) written in the same transaction as the change, plus `manual` entries; cascade on employee delete |
| `employee_compensation` | Salary / stipend / fee revisions | Restricted. `amount DECIMAL(14,2) ≥ 0`, `currency`, `frequency`, `effectiveFrom`; the current value is the latest revision already in effect. Cascade on employee delete |
| `employee_document`, `employee_document_blob` | Documents & employment records | Restricted. Metadata (category, title, sanitised file name, sniffed type, size) separate from the bytes, which are accessed only through the `DocumentStore` interface in `src/server/services/documents.ts`. ≤ 5 MB, PDF/JPEG/PNG/WebP. Cascade on employee delete |
| `employee_photo` | Profile photo bytes | PK = `employeeId` (cascade delete). 512×512 WebP + 96×96 thumbnail, re-encoded on the server (metadata stripped), typically 15–40 KB. Kept out of the `employee` row so directory queries stay small. Accessed only through the `PhotoStore` interface in `src/server/services/photos.ts`, so R2/S3 can replace it without schema changes |
| `employee_code_counter` | Per (prefix, year) sequence | Atomic upsert allocates codes |
| `employee_credential` | QR credentials | `tokenHash` (unique), `tokenCiphertext`, `expiresAt`, `revokedAt`, `revokeReason` |
| `audit_log` | Append-only audit trail | UPDATE/DELETE blocked by trigger |
| `verification_event` | Public verification analytics | Result + keyed IP hash, retention-limited |
| `outbox_event` | Real-time outbox | `pg_notify` trigger on insert; purged after 7 days |
| `company_settings` | Singleton (id = 1) | System Rules (incl. `publicShowPhoto`: whether the verification page shows the photo) |
| `app_rate_limit` | Fixed-window counters | Verification, creation, issuance, bulk, export |

## Status definitions

Three independent dimensions. "Active" never means "online" or "present": the system does **no** presence, location or device tracking.

| Dimension | Values | Meaning |
| --- | --- | --- |
| Employment status | `ACTIVE`, `INACTIVE` | Whether the person is currently employed / authorized. Changed only by explicit HR action |
| Exit | `exitDate` null / set | Set by **Record exit** (also sets `INACTIVE`, so the QR verifies as “Not a current employee”; the credential is not revoked). Cleared when the employee is reactivated (a rejoin). Directory filter “Exited” |
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
- One sequence for the whole group: the code does not depend on the employee's company, so it stays the same if they move between group companies.
- Verified by a 40-way concurrent-creation integration test and a 25-way concurrent HTTP load test.

## Uniqueness and integrity

- Work email: unique case-insensitively when present (`lower("workEmail")` partial unique index).
- At most one non-revoked credential per employee (partial unique index).
- `idExpiresAt >= idIssueDate` (check constraint).
- Foreign keys: credentials → employee `RESTRICT` (an employee can't be removed by accident while credentials exist — the delete service removes them explicitly in the same transaction); audit/verification → user/employee `SET NULL`.
- Duplicate detection (Import page) groups employees whose company, display name, department, job title, business vertical, work location, joining date, phone and work email match (trimmed, case-insensitive). Imports can skip rows matching an existing record or an earlier row of the same file (`?skipDuplicates=1`).

## Indexes

Employee: `employeeCode` (unique), `employmentStatus`, `department`, `jobTitle`, `companyId`, `reportingManagerId`, `idExpiresAt`, `archivedAt`, `(createdAt, id)`, `displayName`, plus `lower(displayName)` and `lower(employeeCode)` pattern indexes. History/compensation/documents: `(employeeId, date)`. Credentials: `tokenHash` (unique), `(employeeId, issuedAt)`, `expiresAt`. Audit: `createdAt`, `(targetType, targetId, createdAt)`, `(actorId, createdAt)`, `(action, createdAt)`.

Name search uses `ILIKE '%term%'` (LIKE wildcards escaped). Measured p95 ≈ 100 ms at 10,000 records under load. For 100k+ records, add a `pg_trgm` GIN index on `displayName`.

## Personal data and retention

Collected: name, optional work email and phone (private, never public, never exported: phone), company, department, designation, business vertical, employment type, work mode and location, team, reporting manager, attendance/leave references, dates (joining, ID validity, exit) and exit reason, an optional profile photo, and — restricted — compensation revisions and uploaded documents (which may include ID proofs; upload masked Aadhaar only). No location tracking, no attendance tracking.

Restricted data: compensation needs `compensation:read` (Owner by default; grantable), documents need `document:read` (Owner and HR Admin by default; grantable). Both are excluded from exports, real-time events and public pages; compensation views and document downloads are audited.

| Data | Retention (configurable in System Rules) |
| --- | --- |
| Audit log | 730 days (min 90). Purge only via `npm run maintenance:retention`, which opts in per transaction |
| Verification events | 90 days |
| Outbox events | 7 days |
| Expired sessions / tokens | Removed by the retention job |
| Employee records | Kept until archived or deleted. Permanent deletion (`employee:delete`, Owner and HR Admin) removes the record, its credentials, photo, documents, compensation and history; direct reports lose the manager link; verification events keep their counts with the employee link set to null, and the append-only audit log keeps an `employee.deleted` entry with the employee code and reason. Codes of deleted employees are never reused |
