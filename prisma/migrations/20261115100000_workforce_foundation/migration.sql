-- Workforce management foundation: employee accounts (roles, link to employee, invite/reset
-- tokens), notifications, announcements, and the row-level security role and helpers.
-- Additive only: existing users, employees and credentials are untouched.

-- CreateEnum
CREATE TYPE "AccountTokenKind" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'TEAM_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'EMPLOYEE';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "employeeId" UUID,
ADD COLUMN     "notifyPunches" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "account_token" (
    "id" UUID NOT NULL,
    "kind" "AccountTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole",
    "employeeId" UUID,
    "userId" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_token_tokenHash_key" ON "account_token"("tokenHash");

-- CreateIndex
CREATE INDEX "account_token_employeeId_idx" ON "account_token"("employeeId");

-- CreateIndex
CREATE INDEX "account_token_userId_idx" ON "account_token"("userId");

-- CreateIndex
CREATE INDEX "notification_recipientId_createdAt_idx" ON "notification"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipientId_dedupeKey_key" ON "notification"("recipientId", "dedupeKey");

-- CreateIndex
CREATE INDEX "announcement_createdAt_idx" ON "announcement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_employeeId_key" ON "user"("employeeId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints and indexes
-- ---------------------------------------------------------------------------

ALTER TABLE "account_token" ADD CONSTRAINT "account_token_target_ck" CHECK (
  ("kind" = 'INVITE' AND "employeeId" IS NOT NULL AND "role" IS NOT NULL)
  OR ("kind" = 'PASSWORD_RESET' AND "userId" IS NOT NULL)
);

-- At most one usable invitation per employee (older ones are revoked when a new one is made).
CREATE UNIQUE INDEX "account_token_live_invite_key" ON "account_token"("employeeId")
  WHERE "kind" = 'INVITE' AND "usedAt" IS NULL AND "revokedAt" IS NULL;

-- Fast unread counts.
CREATE INDEX "notification_unread_idx" ON "notification"("recipientId") WHERE "readAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Row-level security (see docs/DATABASE_DESIGN.md section 3)
--
-- The app connects as the table owner, which bypasses RLS. Services for the workforce modules
-- run inside withRls(): transaction-local settings (app.user_id, app.employee_id, app.team,
-- app.scopes) followed by SET LOCAL ROLE sania_rls, so these policies apply to every query.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sania_rls') THEN
    CREATE ROLE sania_rls NOLOGIN;
  END IF;
END $$;

-- The application's login role must be allowed to SET ROLE sania_rls. On managed Postgres the
-- owner is not a superuser; if the grant is refused the migration still succeeds and the
-- workforce modules fail closed (withRls raises) until an administrator grants it.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'sania_rls', 'SET') THEN
    EXECUTE format('GRANT sania_rls TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not grant sania_rls to %: %', current_user, SQLERRM;
END $$;

GRANT USAGE ON SCHEMA public TO sania_rls;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_employee_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.employee_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_has_scope(scope text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT scope = ANY (string_to_array(coalesce(current_setting('app.scopes', true), ''), ','))
$$;

-- Self, or (team managers only) any direct or indirect report. SECURITY DEFINER so the walk up
-- the reporting chain is not itself subject to the employee policy.
CREATE OR REPLACE FUNCTION app_can_see_employee(target uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_employee_id();
  cur uuid := target;
  steps int := 0;
BEGIN
  IF me IS NULL OR target IS NULL THEN RETURN false; END IF;
  IF target = me THEN RETURN true; END IF;
  IF coalesce(current_setting('app.team', true), '') <> 'on' THEN RETURN false; END IF;
  LOOP
    SELECT e."reportingManagerId" INTO cur FROM "employee" e WHERE e."id" = cur;
    steps := steps + 1;
    IF cur IS NULL OR steps > 50 THEN RETURN false; END IF;
    IF cur = me THEN RETURN true; END IF;
  END LOOP;
END $$;

-- Employees: read-only; HR scopes see everyone, others see themselves and (managers) their team.
ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_rls_read" ON "employee" FOR SELECT TO sania_rls
  USING (app_has_scope('employee') OR app_can_see_employee("id"));
GRANT SELECT ON "employee" TO sania_rls;
GRANT SELECT ON "company" TO sania_rls;

-- Users: only non-sensitive columns (names on comments, tasks, reviewers). No emails or hashes.
GRANT SELECT ("id", "name", "role", "employeeId") ON "user" TO sania_rls;

-- Notifications: each user sees and updates only their own. Inserts fan out to other users
-- (without RETURNING), so INSERT is not restricted by recipient.
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_rls_read" ON "notification" FOR SELECT TO sania_rls
  USING ("recipientId" = app_user_id());
CREATE POLICY "notification_rls_update" ON "notification" FOR UPDATE TO sania_rls
  USING ("recipientId" = app_user_id()) WITH CHECK ("recipientId" = app_user_id());
CREATE POLICY "notification_rls_insert" ON "notification" FOR INSERT TO sania_rls
  WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON "notification" TO sania_rls;

-- Audit and outbox rows are written in the same transaction as the change they describe.
GRANT INSERT ON "audit_log", "outbox_event" TO sania_rls;
GRANT SELECT ("id") ON "audit_log" TO sania_rls;
GRANT SELECT ON "outbox_event" TO sania_rls;
GRANT USAGE ON SEQUENCE "audit_log_id_seq", "outbox_event_id_seq" TO sania_rls;
