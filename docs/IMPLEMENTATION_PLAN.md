# Implementation plan: workforce management

Branch: `workforce-management` (from `main` @ `ff0a24c`). Nothing is deployed until the owner explicitly approves. A deployment readiness report follows Phase 9.

## Decisions and deviations from the brief (with reasons)

| Topic | Decision | Why |
| --- | --- | --- |
| Stack | Keep Next.js + Better Auth + Prisma + PostgreSQL + existing SSE real-time. **No Supabase.** | The brief says to continue with the existing stack; this project never used Supabase. |
| RLS | Native PostgreSQL RLS through a dedicated `sania_rls` role, set per transaction (`withRls`) | It works with a single pooled owner connection, and it is testable locally even as a superuser. See DATABASE_DESIGN §3. |
| Roles | Add **TEAM_MANAGER** and **EMPLOYEE**. Keep HR_STAFF and MANAGEMENT. | Existing accounts keep working. HR_STAFF and MANAGEMENT get read-only access to the new modules. |
| Team | A team manager's team is their **direct and indirect reports** (existing reporting lines) | No second team model to maintain |
| Invitations / password reset | **Single-use, expiring links** that HR copies and shares (e.g. WhatsApp). No email is sent yet. A "Forgot password?" page explains how to get a reset link. | There is no email provider. Sending email needs an external account (e.g. Resend/SMTP), which is the owner's choice. The token model is ready for email delivery later. |
| Attendance roster | Attendance counts cover **active employees who have an active login**. Others appear as "No login yet". | Employees without accounts cannot punch, so they would otherwise show as absent every day. |
| HR punch notifications | Real-time Live Attendance for everyone. **Personal notifications for every punch are opt-in** per HR user. | 200 employees × 2 punches a day would bury actionable notifications |
| Scheduler | Deadline reminders and incomplete-session alerts are generated on use (throttled sweep when people use the app), plus `npm run maintenance:sweep` for a daily cron later | The free tier has no cron; an always-on timer would keep the free database awake |
| Excel export | CSV plus a small built-in `.xlsx` writer (no new dependency) | The brief says not to install dependencies blindly |
| Breaks | Breaks are the gaps between sessions (multiple sessions per day allowed by policy) | Meets "break tracking (optional)" without a second clock |
| Leave approval | HR (`leave:manage`). Team managers can see their team's leave. | As specified |
| Time | UTC `timestamptz` storage; organisation time zone (default Asia/Kolkata) for day boundaries and display | As specified |

## Role → capability matrix

| Capability | OWNER | HR_ADMIN | HR_STAFF | MANAGEMENT | TEAM_MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- | --- | --- |
| HR console (directory, etc.) | ✓ | ✓ | ✓ (read) | ✓ (read) | — | — |
| Employee workspace (`/me`) | if linked | if linked | if linked | if linked | ✓ | ✓ |
| Punch in/out, own history, own leave, own tasks | if linked | if linked | if linked | if linked | ✓ | ✓ |
| View all attendance (`attendance:read`) | ✓ | ✓ | ✓ | ✓ | team only | — |
| Correct attendance, resolve incomplete (`attendance:manage`) | ✓ | ✓ | grantable | — | — | — |
| Create/assign tasks to anyone (`task:manage`) | ✓ | ✓ | grantable | — | team only | — |
| Review tasks | ✓ | ✓ | — | — | own tasks | — |
| Approve leave (`leave:manage`) | ✓ | ✓ | grantable | — | — | — |
| Attendance and leave policies, holidays, leave types (`policy:manage`) | ✓ | ✓ | — | — | — | — |
| Invite employees, reset their passwords, (de)activate employee accounts (`account:manage`) | ✓ | ✓ | grantable | — | — | — |
| Manage HR users and roles (`users:manage`) | ✓ | — | — | — | — | — |
| Send announcements (`announcement:send`) | ✓ | ✓ | grantable | — | — | — |

HR admins can never create or modify OWNER/HR accounts (only `users:manage` can), so "HR cannot modify owner permissions" holds.

## Phases

Each phase ends with typecheck, lint and the relevant tests. Failures are fixed before moving on. A short phase report lists what was built, files and database changes.

1. **Audit and docs.** `ARCHITECTURE_AUDIT.md`, `DATABASE_DESIGN.md`, this plan. Baseline test run.
2. **RBAC, accounts, sessions.** Migration `workforce_foundation`. New roles and permissions; `Actor.employeeId`; employee-linked account checks (inactive or exited employee means no access); `withRls` helper and RLS role; invitations (`/invite/[token]`); password reset links (`/reset-password/[token]`); role-based landing (`/home`); HR console blocks workspace-only roles; Users & Access gains employee linking; an "Employee accounts" panel on the employee profile.
3. **Employee workspace.** `(workspace)` layout with its own sidebar (My Dashboard, My Attendance, My Tasks, My Calendar, My Leave, My Profile, Notifications, Account Settings, plus My Team for managers). Dashboard with welcome, profile card, attendance card and stats. Real-time stream opened to all signed-in users, with per-user audiences.
4. **Attendance core.** Migration `attendance`; time-zone utilities; policy service; punch in/out APIs (server timestamps, advisory lock, constraints); immutable events; employee attendance card with a running timer; logout guard (ALLOW/WARN/BLOCK); own history.
5. **HR attendance.** "Attendance Management" in the sidebar: KPI cards and tabs (Live, Present, Absent, Late, On leave, History, Corrections, Monthly reports); search, sort, filters, pagination; employee attendance history; correction workflow (employee requests, HR applies or rejects, HR direct corrections, resolving incomplete sessions); CSV/XLSX exports; real-time updates; policy and holidays in System Rules.
6. **Tasks.** Migration `tasks`; create/assign (individual, multiple, department); priorities, dates, briefs/attachments; per-assignee status machine and progress; comments; deliverables; submit, approve or reject; history; HR "Task Management" page; employee task board (list, kanban, calendar); manager team tasks.
7. **Leave.** Migration `leave`; leave types and quotas (policy); apply, cancel, clarification loop; HR approve/reject; balances; leave calendar; attendance integration.
8. **Notifications, reporting, exports.** Notification centre (bell with unread count, history, mark read); task, leave and attendance notifications; deadline and overdue sweep; announcements; monthly attendance report; task and leave exports.
9. **Hardening.** RLS and RBAC security tests, IDOR tests through the API, e2e flows (employee login, punch in/out, HR live update, task assign → complete → approve, leave), mobile overflow checks, performance review (indexes, N+1), full regression run, docs (README, DATA_MODEL, SECURITY, TESTING, DEPLOYMENT), deployment readiness report.

## Status (2026-11-14)

All nine phases are implemented and tested on the branch (Vitest 220/220, Playwright 43/43). Nothing is deployed. See [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md).

## Out of scope for this iteration (documented for later)

- Email or SMS delivery of invitations, resets and notifications (needs a provider account).
- Geolocation or IP fencing for punches (the work location is self-declared and audited).
- Per-company attendance policies (one organisation-wide policy now; holidays can be per company).
- Payroll calculations.
