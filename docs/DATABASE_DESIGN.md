# Database design: workforce management extension

The new modules are a **modular extension of the existing schema**. They reuse `employee` (the single employee identity), `user`/`session`/`account` (Better Auth), `company`, `audit_log` and `outbox_event`. No second employee table and no second user store are introduced, and no existing column is changed or removed.

Conventions: UUID primary keys (`@db.Uuid`), BIGINT identity for append-only event tables. Instants are `timestamptz(3)` in UTC, and calendar days are `date`. Day boundaries ("today", work dates) use the organisation time zone from the attendance policy (default `Asia/Kolkata`). Migrations are hand-reviewed SQL, ASCII-only. Every migration is additive.

## 1. Entity map

| Brief entity | Implemented as |
| --- | --- |
| employees | existing `employee` (unchanged; reporting lines already exist via `reportingManagerId`) |
| profiles | `employee` + `user` joined through the new `user.employeeId` |
| roles | `UserRole` enum: existing OWNER, HR_ADMIN, HR_STAFF, MANAGEMENT; **new** TEAM_MANAGER, EMPLOYEE |
| permissions | code-level permission model (`src/server/authorization/permissions.ts`) plus per-user `extraPermissions`, as today |
| attendance_sessions | `attendance_session` |
| attendance_events | `attendance_event` (append-only) |
| attendance_policies | `attendance_policy` (single organisation row) + `holiday` |
| attendance_corrections | `attendance_correction` |
| tasks / task_assignments / task_comments / task_attachments | `task`, `task_assignment`, `task_comment`, `task_file` (+ `task_file_blob`), plus append-only `task_history` |
| leave_requests | `leave_request` + configurable `leave_type` |
| notifications | `notification` (+ `announcement` for HR broadcasts) |
| audit_logs | existing `audit_log` (append-only, trigger-protected) |
| (accounts) | `account_token` for invitations and password-reset links |

## 2. Tables

### 2.1 Identity (migration `workforce_foundation`)

**`user`** (existing) gains:
- `employeeId uuid NULL UNIQUE → employee(id) ON DELETE SET NULL`. This is the stable link between an account and the existing employee record. Because it is unique, one employee can never have two accounts.
- `notifyPunches boolean DEFAULT false`. This is an opt-in for HR users who want a notification on every punch.

**`account_token`** holds single-use links. Only a SHA-256 hash of each token is stored.

| column | type | notes |
| --- | --- | --- |
| id | uuid PK | |
| kind | `AccountTokenKind` (INVITE, PASSWORD_RESET) | |
| tokenHash | text UNIQUE | SHA-256 of a 256-bit random token |
| email | text | login email for invites |
| role | `UserRole` NULL | invite role (EMPLOYEE or TEAM_MANAGER) |
| employeeId | uuid NULL → employee CASCADE | invite target |
| userId | text NULL → user CASCADE | reset target |
| createdById | text NULL → user SET NULL | |
| expiresAt, usedAt, revokedAt, createdAt | timestamptz | invites expire after 7 days; resets after 24 h |

Partial unique index: one **live** invite per employee (`kind='INVITE' AND usedAt IS NULL AND revokedAt IS NULL`).

**`notification`**

| column | type | notes |
| --- | --- | --- |
| id | uuid PK | |
| recipientId | text → user CASCADE | |
| type | text | e.g. `task.assigned`, `leave.approved`, `attendance.incomplete` |
| title, body, link | text | link is an app-relative path |
| entityType, entityId | text NULL | |
| dedupeKey | text NULL | `UNIQUE (recipientId, dedupeKey)` makes reminder sweeps idempotent |
| readAt | timestamptz NULL | |
| createdAt | timestamptz | |

Indexes: `(recipientId, createdAt DESC)`, plus a partial index `(recipientId) WHERE readAt IS NULL` for unread counts.

**`announcement`** stores id, title, body, audience (jsonb: all, company or department), createdById, recipientCount and createdAt.

### 2.2 Attendance (migration `attendance`)

**`attendance_policy`** is a single row (`id = 1`):

| field | default | meaning |
| --- | --- | --- |
| timezone | `Asia/Kolkata` | display time zone and day boundaries |
| shiftStart / shiftEnd | `09:30` / `18:30` | official hours (HH:MM, local) |
| graceMinutes | 15 | punch-in after shiftStart + grace counts as **late** |
| earlyLeaveMinutes | 15 | last punch-out before shiftEnd − this counts as an **early departure** |
| fullDayMinutes / halfDayMinutes | 480 / 240 | thresholds for PRESENT / HALF_DAY |
| allowMultipleSessions | true | allow several sessions per day (breaks are the gaps between sessions) |
| allowedLocations | all three | OFFICE, WORK_FROM_HOME, CLIENT_VISIT |
| weeklyOffDays | `{0}` (Sunday) | 0 = Sunday … 6 = Saturday |
| logoutPolicy | WARN | ALLOW / WARN / BLOCK when signing out with an open session |
| maxSessionHours | 16 | an open session older than this is **incomplete** |
| correctionWindowDays | 7 | how far back employees may request corrections |

**`holiday`** stores id, date, name, companyId (NULL means every company) and createdById. It is unique on `(date, coalesce(companyId, nil-uuid))`.

**`attendance_session`**

| column | type | notes |
| --- | --- | --- |
| id | uuid PK | |
| employeeId | uuid → employee CASCADE | |
| workDate | date | local date of the punch-in (night shifts stay on the day they started) |
| punchInAt / punchOutAt | timestamptz(3) | **server-generated**; punchOutAt NULL while open |
| location | `AttendanceLocation` | OFFICE, WORK_FROM_HOME, CLIENT_VISIT |
| status | `AttendanceSessionStatus` | OPEN, CLOSED, CORRECTED, VOIDED |
| durationSeconds | int NULL | set on close or correction |
| needsReview | boolean | e.g. closed after maxSessionHours |
| notes, reviewNote | text | |
| createdById, closedById | text NULL | user ids |
| version | int | optimistic concurrency |

Constraints:
- `CHECK (punchOutAt IS NULL OR punchOutAt > punchInAt)`
- `CHECK ((status = 'OPEN') = (punchOutAt IS NULL))`
- **One open session per employee:** `UNIQUE (employeeId) WHERE status = 'OPEN'`
- **No overlapping sessions:** `EXCLUDE USING gist (employeeId WITH =, tstzrange(punchInAt, coalesce(punchOutAt, 'infinity'), '[)') WITH &&) WHERE (status <> 'VOIDED')` (requires `btree_gist`). Corrections therefore cannot create double-counted time.

Indexes: `(employeeId, workDate)`, `(workDate)`, `(status) WHERE status = 'OPEN'`.

**`attendance_event`** is append-only. A trigger blocks UPDATE, and blocks DELETE unless it comes from a cascading parent delete or the retention purge flag is set.

| column | type |
| --- | --- |
| id | bigint identity PK |
| employeeId | uuid → employee CASCADE |
| sessionId | uuid NULL → attendance_session CASCADE |
| type | `AttendanceEventType`: PUNCH_IN, PUNCH_OUT, SESSION_ADDED, SESSION_CORRECTED, SESSION_VOIDED, SESSION_RESOLVED |
| occurredAt | timestamptz (server time) |
| actorId | text NULL (no FK, so history survives user deletion) |
| metadata | jsonb (before/after times, location, reason) |

Indexes: `(employeeId, occurredAt)`, `(sessionId)`.

**`attendance_correction`** handles both employee requests and HR-applied corrections.

| column | type | notes |
| --- | --- | --- |
| id | uuid PK | |
| employeeId | uuid → employee CASCADE | |
| sessionId | uuid NULL → attendance_session SET NULL | |
| kind | `CorrectionKind` | ADD_SESSION, CHANGE_TIMES, CLOSE_SESSION, VOID_SESSION |
| status | `CorrectionStatus` | PENDING, APPLIED, REJECTED, CANCELLED |
| workDate | date | |
| punchInAt, punchOutAt, location | requested values | |
| reason | text NOT NULL | |
| requestedById, reviewedById | text NULL → user SET NULL | |
| reviewNote | text | |
| before, after | jsonb | snapshot of the session before and after an applied correction |
| createdAt, reviewedAt | timestamptz | |

Indexes: `(status, createdAt)`, `(employeeId, createdAt)`.

### 2.3 Tasks (migration `tasks`)

**`task`**: id uuid; `number int identity UNIQUE` (shown as `TSK-00042`); title; description; priority `TaskPriority` (LOW, MEDIUM, HIGH, CRITICAL); target `TaskTarget` (INDIVIDUAL, MULTIPLE, DEPARTMENT); department NULL; startDate and dueDate (`date` NULL); createdById → user SET NULL; cancelledAt, cancelledById, cancelReason; createdAt, updatedAt; version. `CHECK (dueDate >= startDate)`. Indexes: `(createdById, createdAt)`, `(dueDate)`.

**`task_assignment`**: id uuid; taskId → task CASCADE; employeeId → employee CASCADE; status `TaskStatus` (ASSIGNED, ACCEPTED, IN_PROGRESS, SUBMITTED, APPROVED, REJECTED, CANCELLED); progress int `CHECK 0..100`; acceptedAt, startedAt, submittedAt, reviewedAt, reviewedById, reviewNote; createdAt, updatedAt; version. `UNIQUE (taskId, employeeId)`. Indexes: `(employeeId, status)`, `(status)`.

**`task_comment`**: id uuid; taskId → task CASCADE; assignmentId → task_assignment CASCADE (each assignee has a private thread with the assigner and HR); authorId → user SET NULL; body; createdAt. Index: `(assignmentId, createdAt)`.

**`task_file`** and **`task_file_blob`**: kind `TaskFileKind` (BRIEF on the task, DELIVERABLE on an assignment). Metadata matches `employee_document`; bytes sit behind the same store interface, so they can move to object storage later.

**`task_history`** is append-only (same trigger as `attendance_event`): bigint id, taskId, assignmentId, actorId, action, fromStatus, toStatus, progress, note, createdAt. Index: `(taskId, createdAt)`.

### 2.4 Leave (migration `leave`)

**`leave_type`**: id uuid; `code UNIQUE`; name; isPaid; annualQuota `decimal(5,1)` NULL (NULL means no limit); allowHalfDay; isActive; sortOrder. The migration seeds Casual (CL, 12), Sick (SL, 12), Earned (EL, 15) and Unpaid (LOP, unlimited). All are editable.

**`leave_request`**: id uuid; employeeId → employee CASCADE; leaveTypeId → leave_type RESTRICT; startDate, endDate (`date`); halfDay `LeaveHalfDay` (NONE, FIRST_HALF, SECOND_HALF; single-day only); days `decimal(5,1)` (working days, excluding weekly offs and holidays); reason; status `LeaveStatus` (PENDING, CLARIFICATION, APPROVED, REJECTED, CANCELLED); reviewerId; reviewNote; decidedAt; createdAt, updatedAt; version.

Constraints:
- `CHECK (endDate >= startDate)`
- `CHECK (halfDay = 'NONE' OR startDate = endDate)`
- **No overlapping active requests:** `EXCLUDE USING gist (employeeId WITH =, daterange(startDate, endDate, '[]') WITH &&) WHERE (status IN ('PENDING','CLARIFICATION','APPROVED'))`

Indexes: `(employeeId, startDate)`, `(status, startDate)`.

Approved leave feeds attendance reporting: a day covered by approved leave is ON_LEAVE, never ABSENT.

## 3. Row-level security

The application connects as a single database owner role, as Prisma requires. Table owners bypass RLS. Every new service function therefore runs its queries inside **`withRls(db, actor, fn)`**, which, inside one transaction:

1. sets transaction-local settings: `app.user_id`, `app.employee_id`, `app.team` (TEAM_MANAGER) and `app.scopes` (a list derived from the actor's permissions, e.g. `attendance,attendance_manage,task,leave`);
2. runs `SET LOCAL ROLE sania_rls`, a `NOLOGIN` role with only the grants it needs.

From that point PostgreSQL enforces the policies, even if a service query were wrong. The settings and role reset automatically at commit or rollback, so pooled connections never leak context.

Helper functions:
- `app_user_id()`
- `app_employee_id()`
- `app_has_scope(text)`
- `app_can_see_employee(uuid)`: self, or (TEAM_MANAGER) any direct or indirect report. This uses a recursive reporting-chain walk as `SECURITY DEFINER` with a fixed `search_path`.
- `app_can_see_task(uuid)`

Policies (role `sania_rls`):

| table | SELECT | INSERT / UPDATE |
| --- | --- | --- |
| employee | any HR read scope, or `app_can_see_employee(id)` | none (read-only grant) |
| attendance_session, attendance_event, attendance_correction | `attendance` scope or `app_can_see_employee(employeeId)` | own employee id, or `attendance_manage` scope |
| task | `task` scope, creator, or an assignment the user can see | creator; `task_manage` scope |
| task_assignment, task_comment, task_file, task_history | through `app_can_see_task` / visible assignment | assignee updates own assignment; creator/`task_manage` |
| leave_request | `leave` scope or `app_can_see_employee(employeeId)` | own employee id, or `leave_manage` scope |
| notification | `recipientId = app_user_id()` | insert allowed (system fan-out); update own |
| attendance_policy, holiday, leave_type | readable by all | `policy_manage` scope |

Column-level grants keep `user` limited to `id, name, role, employeeId` for the RLS role. Password hashes, emails and sessions are never readable inside an RLS transaction. Compensation, documents, credentials and photos have **no** grants to the RLS role at all.

Tests (`tests/security/rls.test.ts`) run raw SQL as the RLS role for different actors and assert that cross-employee rows are invisible and that writes outside a user's scope are rejected.

## 4. Transactions and concurrency

- **Punch in/out:** one transaction holds a per-employee advisory lock (`pg_advisory_xact_lock(hashtext('attendance:'||employeeId))`), then checks state, writes the session, the event, the audit row and the outbox row. The unique index and exclusion constraint are the final guard against double-submits from multiple tabs or devices; a violation maps to a friendly 409.
- **Task and leave transitions:** an optimistic `version` check plus a status whitelist, enforced in a single `UPDATE … WHERE status IN (...)`.
- **Corrections:** applied in one transaction that rewrites the session, appends an event, records before/after and audits.

## 5. Migrations

| migration | contents |
| --- | --- |
| `20261115100000_workforce_foundation` | new roles, `user.employeeId`, `account_token`, `notification`, `announcement`, RLS role + helper functions, employee/notification policies |
| `20261115110000_attendance` | `btree_gist`, attendance enums and tables, policy row, holidays, constraints, immutability trigger, RLS |
| `20261115120000_tasks` | task tables, history trigger, RLS |
| `20261115130000_leave` | leave types (seeded), leave requests, exclusion constraint, RLS |

All four are additive. Existing employees, users, credentials and QR tokens are untouched.
