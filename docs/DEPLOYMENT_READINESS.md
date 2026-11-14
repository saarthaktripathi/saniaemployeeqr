# Deployment readiness report: workforce management release

Branch `workforce-management` · prepared 2026-11-14 · **deployment approved by the owner on 2026-11-15** ("go live").

## 1. What is being released

| Phase | Delivered |
| --- | --- |
| 2 · Accounts and access | Roles **Team Manager** and **Employee**. Logins linked to the existing employee record (one per employee). Invitation and password-reset links (single use, hashed, expiring). **Employee Access** page. Role-based landing. HR console closed to workspace roles. Employee exit, deactivation or archiving locks the login. |
| 3 · Employee workspace | `/me`: dashboard (welcome, profile, attendance card, month and task stats), My Attendance, My Tasks, My Calendar, My Leave, My Profile, Notifications, Account Settings. My Team and Team Tasks for managers. |
| 4 · Attendance core | Punch IN/OUT with server timestamps, work location, running timer, multiple sessions, the logout guard (ALLOW/WARN/BLOCK), and append-only attendance events. |
| 5 · HR attendance | **Attendance Management**: 10 KPIs; Live, Present, Absent, Late, On leave and Incomplete tabs; history; per-employee month view with audit trail; correction workflow (request → apply/reject, HR direct corrections, missed punch-out resolution); monthly reports; CSV/Excel exports; live updates; rules, holidays and leave types. |
| 6 · Tasks | Create and assign to one person, several people or a department (HR) or to the team (managers). Priorities, dates, attachments, per-assignee status and progress, private comment threads, deliverables, submit → approve/reject, append-only history. List, kanban and calendar boards. |
| 7 · Leave | Configurable types and quotas, apply/cancel, clarification loop, HR approve/reject, balances, leave calendar. Approved leave shows on attendance and is never counted as absence. |
| 8 · Notifications and reporting | Personal notification centre with unread count, history and mark-read. Real-time delivery. Deadline, overdue, missed-deadline and incomplete-session reminders. Announcements. Exports. |
| 9 · Hardening | PostgreSQL row-level security on all new tables and on `employee`. Security, RLS and IDOR tests. Mobile checks. Docs. |

## 2. Database changes (all additive)

| Migration | Summary | Risk |
| --- | --- | --- |
| `20261115100000_workforce_foundation` | `UserRole` +2 values, `user.employeeId` (nullable, unique), `user.notifyPunches`, `account_token`, `notification`, `announcement`, the `sania_rls` role, RLS helper functions, policies on `employee` and `notification` | **Medium**: creates a database role and grants the app's login role `SET ROLE` on it (see §4) |
| `20261115110000_attendance` | `btree_gist` extension, attendance tables, policy row, holidays, exclusion constraint, append-only trigger, RLS | Low: requires the `btree_gist` extension (available on Neon) |
| `20261115120000_tasks` | Task tables, history trigger, RLS | Low |
| `20261115130000_leave` | Leave types (4 seeded) and requests with an overlap exclusion constraint, RLS | Low |

No existing column is changed or dropped. Existing employees, users, QR credentials, photos, documents and compensation are untouched. Existing HR accounts keep their roles. MANAGEMENT and HR_STAFF gain **read-only** access to attendance, tasks and leave.

## 3. Verification performed (local, 2026-11-14)

| Check | Result |
| --- | --- |
| Lint / typecheck / production build | pass / pass / pass |
| Vitest (unit + integration, real PostgreSQL) | **222 / 222** (18 files). Coverage: statements 88.9%, branches 76.2%, functions 90.4%, lines 93.6% |
| Playwright e2e (production build) | **43 / 43** (31 existing + 12 new: employee login and workspace, HR console and API blocked for employees, punch in/out with live HR update, logout guard, incomplete-session resolution, correction request → apply, task assign → work → submit → approve, leave apply → approve, team manager scope, invitation → set password → login, mobile overflow on 22 new pages) |
| Migration drift (`prisma migrate diff`) | no difference |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Seed (30 employees, fresh database) | pass; creates employee and team-manager logins through the real invitation flow |

**Defects found by these tests and fixed before this report:**
1. Workspace roles could hold extra permissions if one were ever stored on the account. They now ignore extra grants entirely.
2. On the filtered "No login" list, the one-time invitation link dialog disappeared before HR could copy it. The list now refreshes only after the dialog closes.
3. Correction dialogs reused element ids, so labels attached to the wrong (hidden) field, an accessibility defect. They now use unique ids.

**Pre-existing, unrelated:** the GitHub CI "End-to-end tests" step has failed since before the directory release while passing locally. Logs need GitHub access (`gh auth login`) to diagnose. Render deploys regardless of CI.

## 4. Risks and required pre-production checks

1. **RLS role on Neon (must verify).** The app connects as Neon's owner role, which is not a superuser. The foundation migration creates `sania_rls` and grants the owner `SET ROLE` on it. If Neon refuses that grant, the migration still succeeds (it only warns), but every attendance, task, leave and notification request would fail with a permission error. The rest of the app (directory, QR verification) keeps working.
   **Rehearsed locally (2026-11-15), without Neon access:** a fresh PostgreSQL cluster with a Neon-style owner (`neondb_owner`: CREATEROLE, CREATEDB, BYPASSRLS, member of `neon_superuser`, **not** a superuser). The currently live migrations were applied first, then the four new ones, the same way Render applies them at start. Results:
   - The grant succeeded (`pg_has_role(current_user, 'sania_rls', 'SET')` = `t`, INHERIT = `f`) and `btree_gist` installed.
   - All 127 integration and security tests passed connected as that owner.
   - An owner that *cannot* obtain the role still migrates cleanly (warning only), and `/api/ready` then returns **503 `{"status":"degraded","rowSecurity":"unavailable"}`**.

   **On the live site:** `/api/ready` must return `{"status":"ready"}` after the deploy. It now also switches to `sania_rls` in a rolled-back transaction. If it reports `degraded`, run this once in the Neon SQL editor as the owner and redeploy: `GRANT sania_rls TO neondb_owner WITH INHERIT FALSE, SET TRUE;`. That can happen on PostgreSQL 15 or older, where the grant syntax doesn't exist; there, use `GRANT sania_rls TO neondb_owner;`. The directory and QR verification are unaffected either way.
2. **Free tier suitability.** Render's free instance sleeps after 15 minutes. The first punch-in after a quiet period waits about a minute. Employee dashboards also keep Neon awake for longer (100 compute-hours/month on the free plan). **Recommendation:** move to Render Starter ($7/month) before employees depend on punching in, and watch Neon usage in the first weeks.
3. **No email provider.** Invitations and password resets are links HR copies and shares privately. That is secure (single use, hashed, expiring) but manual. Email delivery needs a provider account, which is the owner's choice.
4. **Self-declared work location.** There is no GPS or IP fencing; the location is audited. Add geofencing later if required.
5. **Reminders are opportunistic.** They're generated when people use the app (at most every 10 minutes). For guaranteed daily reminders, schedule `npm run maintenance:sweep` (e.g. a Render cron job, which is paid).
6. **Rollback.** Code: Render "Rollback" to the previous deploy. The previous code ignores the new tables, but users with the new roles (EMPLOYEE/TEAM_MANAGER) would be treated as unknown roles with no permissions. Schema: the migrations are additive; don't drop them on rollback. Take a Neon snapshot (or rely on the branch from step 1) before deploying.

## 5. Go-live steps (after approval)

1. Rehearse the role grant (done locally, §4.1). After the deploy, `/api/ready` must report `ready`.
2. Merge `workforce-management` into `main` and push. Render builds (~5 min) and runs the four migrations at start.
3. Smoke test on the live site:
   - `/api/health`, and `/api/ready` returns `{"status":"ready"}` (database and row-security role)
   - owner login and the directory (unchanged)
   - an existing QR still shows VALID
   - **Attendance Management**, **Task Management** and **Leave Management** load
   - under Rules & Holidays, check the shift times and time zone (default 09:30–18:30, Asia/Kolkata) and add this year's holidays
4. Invite one real employee from **Employee Access**, sign in as them on a phone, punch in and out, and confirm HR sees it live.
5. Then invite the rest in batches. Make line managers **Team Managers** (Employee Access → Make manager) and check reporting managers are set in the directory.
