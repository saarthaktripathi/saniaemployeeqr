# Sania Employee Identity & Verification Platform

**Sania Job Bowl** — *Connecting Talent. Creating the Future.*

A full-stack web application for managing employee records and issuing a unique, revocable QR credential to each employee. Anyone can scan the QR to see the **current** status of that employee record; owners and HR staff manage everything from a restricted, real-time dashboard.

> "Live monitoring" here means live **record status** (active / inactive / revoked) pushed to HR dashboards in real time. The system does not track employee location, devices or online presence.

| Area | What it does |
| --- | --- |
| Group employee directory | One directory for every company of the Sania group: company, business vertical, department, designation, employment type (full-time, part-time, contract, consultant, intern), work mode (office/remote/hybrid) and location, team and reporting manager with direct reports, official email and contact number, attendance/leave references, exit details and an employment-history timeline |
| HR dashboard | Collapsible sidebar, notifications (recent activity), interactive KPI cards that filter the directory in place; server-side search (name, ID, email), filters by company, department, designation, status (incl. exited), employment type, work mode, QR and ID validity; sort and pagination; table with photos (cards on phones); add/edit; deactivate/reactivate/record exit/archive; delete (single or bulk); CSV/Excel import, CSV export; live updates across sessions |
| Restricted records | Salary / stipend / fee revisions (Owner only unless granted; hidden until shown, every view logged) and employee documents (offer letters, contracts, ID proofs…; PDF/images ≤ 5 MB; HR Admin and Owner, downloads logged) |
| Employee photos | Drag-and-drop upload with circular crop, zoom and reposition; JPEG/PNG/WebP; compressed in the browser and re-encoded on the server; shown in the directory, profile, ID card and verification page |
| Digital ID card | Corporate CR80 card with photo, name, designation, ID, department, validity, live status and QR; download as PNG or PDF, or print |
| Duplicate cleanup | Import can skip employees that already exist; the Import page lists duplicate records (e.g. a CSV uploaded twice) and removes the extra copies in one click, keeping one per person |
| QR credentials | Issue, preview, copy, print, reissue and revoke. Each QR holds only an opaque 256-bit token |
| Public verification | `/verify/<token>` (mobile-first, no login) shows the ID card with photo and one of five verdicts: **VALID**, **INACTIVE**, **EXPIRED**, **REVOKED**, **INVALID** — decided by the server on every scan |
| Employee workspace | Every employee can have their own login (invited by HR, linked to their existing record): dashboard, punch in/out, attendance history and correction requests, task board (list, kanban, calendar), leave balances and applications, calendar, profile, notifications |
| Attendance management | Server-timestamped punch in/out (office, work from home, client visit), multiple sessions, live HR board with 10 KPIs and tabs (live, present, absent, late, on leave, incomplete), history, per-employee audit trail, audited corrections, monthly reports, CSV/Excel exports, configurable shift/grace/half-day rules, weekly offs and holidays |
| Tasks | Assign to people, departments (HR) or your team (managers); priorities, dates, attachments; per-assignee progress, private comment threads, deliverables, submit → approve/reject with history |
| Leave | Configurable leave types and yearly quotas, apply/cancel, clarification requests, HR approval, leave calendar; approved leave never counts as absence |
| Notifications | In-app notification centre with unread counts and live delivery (tasks, leave, attendance, deadlines, announcements) |
| Access control | Owner / HR Administrator / HR Staff / Management / **Team Manager** / **Employee** roles plus individually grantable permissions, enforced on the server **and** by PostgreSQL row-level security for workforce data |
| Security | Argon2id passwords, TOTP MFA (enforceable for privileged roles and anyone with salary/document access), DB-backed rate limits, CSP with nonces, CSRF origin checks, append-only audit log |

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

The seed prints six **local-only** accounts (Owner, HR Admin, HR Staff, Management, Team Manager `manager@sania.local`, Employee `employee@sania.local`) with random passwords, creates three fictional group companies, two weeks of attendance, tasks and leave. MFA enforcement is switched off in the local seed only; turn it on under **System Rules**.

## Workforce management (attendance, tasks, leave)

1. **Give employees a login:** HR → **Employee Access** → **Invite** next to an employee → copy the one-time link and send it privately (WhatsApp/SMS). The employee opens it, chooses a password and lands in their workspace (`/me`). Links work once and expire after 7 days; password-reset links after 24 hours. No email provider is needed.
2. **Team managers:** Employee Access → **Make manager**. A team is everyone who reports to them (directly or indirectly) according to the directory's reporting manager field.
3. **Rules:** Attendance Management → **Rules & holidays**: time zone, shift start/end, grace period, early-departure threshold, full/half-day minutes, weekly offs, allowed work locations, sign-out policy, missed punch-out limit, correction window, holidays, leave types and quotas.
4. **Daily use:** employees punch in/out on **My Dashboard**; HR watches **Attendance Management** (updates live), resolves missed punch-outs and correction requests, approves leave under **Leave Management** and assigns work under **Task Management**.

Signing out never punches anyone out; depending on the rule, employees are warned or must punch out first. Attendance covers employees who have a login. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for decisions and [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) for the data model and row-level security.

## Group employee directory

- **Companies** (Owner, sidebar → Companies): add, rename, mark inactive or delete (only when empty) the companies of the Sania group. Every employee belongs to one company; inactive companies keep their employees but can't receive new ones. While the group has a single active company it is chosen automatically.
- **Employee IDs** stay one group-wide sequence (`SJB-2026-001`…), so an ID is unique across all companies and doesn't change when someone moves between companies.
- **Employee profile** tabs: *Overview* (status, company/role/reporting, contact, attendance & leave references, QR credential and verification details), *Employment history* (automatic entries for joining, designation/department/company/manager/type/mode/location changes, exit and rejoin; manual entries for earlier history), *Documents*, *Compensation* and *Activity* — restricted tabs appear only with the matching permission.
- **Record exit** (permission `employee:deactivate`): last working day, exit type and reason. The employee becomes inactive, so their QR verifies as “Not a current employee”; the record stays in the directory. **Reactivate** later records a rejoin and clears the exit.
- **Compensation**: revisions (salary, stipend or consulting fee; amount, currency, monthly/annual/hourly, effective date). Owner only by default — grant `compensation:read` / `compensation:manage` to specific users under Users & Access. Values are fetched only when someone presses **Show**, every view is in the activity log, and amounts never appear in exports, events or public pages.
- **Documents**: PDF, JPEG, PNG or WebP up to 5 MB, checked by content (not file name). Stored in the `employee_document_blob` table behind a store interface (R2/S3 can replace it). HR Admin and Owner by default; every download is logged. Upload masked Aadhaar copies only.
- **Attendance & leave references**: optional fields (biometric ID, leave policy, external HRMS link). Attendance and leave themselves are tracked in the workforce modules below.
- **Import columns** add `company` (name or short code), `employmentType`, `workMode`, `team`, `reportingManager` (an existing employee ID), `attendanceRef`, `leavePolicy`. **Export** adds company, type, work mode, team, manager ID, joining and exit dates (never phone, salary or documents).

The `20261114120000_employee_directory` migration is additive: it creates the primary company from System Rules (“Sania Job Bowl”), assigns every existing employee to it and starts each timeline with a “Joined” entry. On Render it runs automatically at start.

## Removing employees

Owners and HR Administrators (permission `employee:delete`) can permanently delete employee records:

- **Directory (Dashboard):** the trash icon on a row deletes that employee. Tick several rows (or the header checkbox for the whole page) and use **Delete** in the bulk bar to remove many at once.
- **Employee profile:** **Delete** next to the status actions.
- **Bulk import page → Duplicate employees:** if the same CSV was uploaded twice, matching records are grouped here. **Remove N duplicates** deletes every extra copy in one step (up to 1,000 per click) and keeps one record per person — the one with a QR credential, otherwise the oldest. Each group also has its own **Remove copy** button.
- **Prevent duplicates:** the import form's **Skip employees that already exist** option (on by default) ignores rows that match an existing record or an earlier row in the same file.

Deletion asks for a reason, is all-or-nothing, removes the employee's QR credentials (printed QRs then show *Invalid*) and is recorded in the append-only audit log. It cannot be undone — use **Archive** if the record may be needed later. Records match as duplicates when company, name, department, job title, business vertical, location, joining date, phone and work email are all equal (ignoring case and extra spaces).

API: `POST /api/employees/delete` with `{ "ids": [...], "reason": "..." }`; `GET /api/employees/duplicates`; `POST /api/employees/import?skipDuplicates=1`.

## Employee photos and ID cards

1. **Add Employee** (or **Edit**) → drag a photo onto the upload area or press **Browse files**. Drag to reposition, use the slider or mouse wheel to zoom, and press **Replace** or **Remove** if needed. The photo uploads (with a progress bar) right after the record is saved.
2. On the employee page, **Issue QR credential**, then **ID card** → **PNG**, **PDF** (card-sized) or **Print**.
3. Scanning the QR opens `/verify/<token>` on any phone, with no login. It shows the card with the photo and a live verdict. Deactivating, revoking or expiry changes the verdict immediately.
4. **System Rules → Employee photo** controls whether the photo appears on the public page.

Photos are stored in the `employee_photo` table (≈30 KB each), never in the employee row. The storage is behind an interface, so an object store (Cloudflare R2 / S3) can replace it later without changing the pages. The `20261101120000_employee_photo` migration only adds tables and columns; on Render it runs automatically at start.

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
| `maintenance:sweep` | Task due/overdue reminders and missed punch-out alerts (idempotent; the app also runs it while in use) |

On Windows with little space on C:, set `PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright` before `npx playwright install chromium` and `npm run test:e2e`. The project `.npmrc` keeps the npm cache on D:.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flows, trust boundaries, decisions
- [Data model](docs/DATA_MODEL.md) — tables, statuses, ID generation, retention
- [Security](docs/SECURITY.md) — threat model, mitigations, residual risks
- [Testing](docs/TESTING.md) — test strategy, results, measured load figures, implementation checklist
- [Deployment](docs/DEPLOYMENT.md) — hosting comparison, recommended plan, domain options, runbooks
- [Architecture audit](docs/ARCHITECTURE_AUDIT.md), [Implementation plan](docs/IMPLEMENTATION_PLAN.md), [Database design](docs/DATABASE_DESIGN.md) — workforce management extension
- [Deployment readiness](docs/DEPLOYMENT_READINESS.md) — workforce release: changes, verification, risks, go-live steps
- [Project report (PDF)](docs/Project-Report.pdf) — full project overview: features, architecture, security, testing, deployment

## Status

Running as a **free-tier trial**: the app on **Render** (Blueprint in `render.yaml`) and PostgreSQL on **Neon**. Every push to `main` redeploys automatically; migrations run on start (`npm run start:prod`). Paid hosting and a custom domain still require the owner's approval — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
