-- Attendance: policy, holidays, sessions (server-timestamped), append-only events, corrections.
-- Additive only. See docs/DATABASE_DESIGN.md section 2.2.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "AttendanceLocation" AS ENUM ('OFFICE', 'WORK_FROM_HOME', 'CLIENT_VISIT');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'CORRECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('PUNCH_IN', 'PUNCH_OUT', 'SESSION_ADDED', 'SESSION_CORRECTED', 'SESSION_VOIDED', 'SESSION_RESOLVED');

-- CreateEnum
CREATE TYPE "CorrectionKind" AS ENUM ('ADD_SESSION', 'CHANGE_TIMES', 'CLOSE_SESSION', 'VOID_SESSION');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogoutPolicy" AS ENUM ('ALLOW', 'WARN', 'BLOCK');

-- CreateTable
CREATE TABLE "attendance_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "shiftStart" TEXT NOT NULL DEFAULT '09:30',
    "shiftEnd" TEXT NOT NULL DEFAULT '18:30',
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 15,
    "fullDayMinutes" INTEGER NOT NULL DEFAULT 480,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "allowMultipleSessions" BOOLEAN NOT NULL DEFAULT true,
    "allowedLocations" "AttendanceLocation"[] DEFAULT ARRAY['OFFICE', 'WORK_FROM_HOME', 'CLIENT_VISIT']::"AttendanceLocation"[],
    "weeklyOffDays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "logoutPolicy" "LogoutPolicy" NOT NULL DEFAULT 'WARN',
    "maxSessionHours" INTEGER NOT NULL DEFAULT 16,
    "correctionWindowDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "attendance_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" UUID,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_session" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "punchInAt" TIMESTAMPTZ(3) NOT NULL,
    "punchOutAt" TIMESTAMPTZ(3),
    "location" "AttendanceLocation" NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'OPEN',
    "durationSeconds" INTEGER,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "reviewNote" TEXT,
    "createdById" TEXT,
    "closedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_event" (
    "id" BIGSERIAL NOT NULL,
    "employeeId" UUID NOT NULL,
    "sessionId" UUID,
    "type" "AttendanceEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "attendance_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "sessionId" UUID,
    "kind" "CorrectionKind" NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "workDate" DATE NOT NULL,
    "punchInAt" TIMESTAMPTZ(3),
    "punchOutAt" TIMESTAMPTZ(3),
    "location" "AttendanceLocation",
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "attendance_correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holiday_date_idx" ON "holiday"("date");

-- CreateIndex
CREATE INDEX "attendance_session_employeeId_workDate_idx" ON "attendance_session"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_session_workDate_idx" ON "attendance_session"("workDate");

-- CreateIndex
CREATE INDEX "attendance_event_employeeId_occurredAt_idx" ON "attendance_event"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "attendance_event_sessionId_idx" ON "attendance_event"("sessionId");

-- CreateIndex
CREATE INDEX "attendance_correction_status_createdAt_idx" ON "attendance_correction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_correction_employeeId_createdAt_idx" ON "attendance_correction"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints, indexes and triggers
-- ---------------------------------------------------------------------------

INSERT INTO "attendance_policy" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_single_row_ck" CHECK ("id" = 1);
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_values_ck" CHECK (
  "shiftStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "shiftEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "graceMinutes" BETWEEN 0 AND 240 AND "earlyLeaveMinutes" BETWEEN 0 AND 240
  AND "halfDayMinutes" BETWEEN 0 AND 1440 AND "fullDayMinutes" BETWEEN "halfDayMinutes" AND 1440
  AND "maxSessionHours" BETWEEN 1 AND 48 AND "correctionWindowDays" BETWEEN 0 AND 90
  AND "weeklyOffDays" <@ ARRAY[0,1,2,3,4,5,6]
);

-- One holiday per date per company (null company = every company).
CREATE UNIQUE INDEX "holiday_date_company_key" ON "holiday" ("date", COALESCE("companyId", '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_times_ck"
  CHECK ("punchOutAt" IS NULL OR "punchOutAt" > "punchInAt");
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_open_ck"
  CHECK (("status" = 'OPEN') = ("punchOutAt" IS NULL));
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_duration_ck"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);

-- At most one open session per employee (duplicate punch-ins from two tabs or devices).
CREATE UNIQUE INDEX "attendance_session_one_open_key" ON "attendance_session" ("employeeId") WHERE "status" = 'OPEN';

-- Sessions of one employee never overlap (voided ones excepted), so time is never double-counted.
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_no_overlap"
  EXCLUDE USING gist ("employeeId" WITH =, tstzrange("punchInAt", COALESCE("punchOutAt", 'infinity'::timestamptz), '[)') WITH &&)
  WHERE ("status" <> 'VOIDED');

CREATE INDEX "attendance_session_open_idx" ON "attendance_session" ("punchInAt") WHERE "status" = 'OPEN';

ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_times_ck"
  CHECK ("punchOutAt" IS NULL OR "punchInAt" IS NULL OR "punchOutAt" > "punchInAt");

-- Append-only tables: block UPDATE always, and DELETE unless it cascades from a parent row
-- (trigger depth > 1, e.g. permanently deleting an employee record) or the retention purge
-- flag is set for the transaction.
CREATE OR REPLACE FUNCTION append_only_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (pg_trigger_depth() > 1 OR current_setting('app.audit_purge', true) = 'on') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_event_no_update BEFORE UPDATE ON "attendance_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_mutation();
CREATE TRIGGER attendance_event_no_delete BEFORE DELETE ON "attendance_event"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Employees may also see their own managers (name and designation on their profile).
CREATE OR REPLACE FUNCTION app_is_my_manager(target uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_employee_id();
  cur uuid := me;
  steps int := 0;
BEGIN
  IF me IS NULL OR target IS NULL OR target = me THEN RETURN false; END IF;
  LOOP
    SELECT e."reportingManagerId" INTO cur FROM "employee" e WHERE e."id" = cur;
    steps := steps + 1;
    IF cur IS NULL OR steps > 50 THEN RETURN false; END IF;
    IF cur = target THEN RETURN true; END IF;
  END LOOP;
END $$;

ALTER POLICY "employee_rls_read" ON "employee"
  USING (app_has_scope('employee') OR app_can_see_employee("id") OR app_is_my_manager("id"));

-- Recipient lookups for notifications (no emails, no hashes).
GRANT SELECT ("isActive", "extraPermissions", "notifyPunches") ON "user" TO sania_rls;

ALTER TABLE "attendance_session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_session_rls_read" ON "attendance_session" FOR SELECT TO sania_rls
  USING (app_has_scope('attendance') OR app_can_see_employee("employeeId"));
CREATE POLICY "attendance_session_rls_insert" ON "attendance_session" FOR INSERT TO sania_rls
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('attendance_manage'));
CREATE POLICY "attendance_session_rls_update" ON "attendance_session" FOR UPDATE TO sania_rls
  USING ("employeeId" = app_employee_id() OR app_has_scope('attendance_manage'))
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('attendance_manage'));
GRANT SELECT, INSERT, UPDATE ON "attendance_session" TO sania_rls;

ALTER TABLE "attendance_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_event_rls_read" ON "attendance_event" FOR SELECT TO sania_rls
  USING (app_has_scope('attendance') OR app_can_see_employee("employeeId"));
CREATE POLICY "attendance_event_rls_insert" ON "attendance_event" FOR INSERT TO sania_rls
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('attendance_manage'));
GRANT SELECT, INSERT ON "attendance_event" TO sania_rls;
GRANT USAGE ON SEQUENCE "attendance_event_id_seq" TO sania_rls;

ALTER TABLE "attendance_correction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_correction_rls_read" ON "attendance_correction" FOR SELECT TO sania_rls
  USING (app_has_scope('attendance') OR app_can_see_employee("employeeId"));
CREATE POLICY "attendance_correction_rls_insert" ON "attendance_correction" FOR INSERT TO sania_rls
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('attendance_manage'));
CREATE POLICY "attendance_correction_rls_update" ON "attendance_correction" FOR UPDATE TO sania_rls
  USING (app_has_scope('attendance_manage') OR ("employeeId" = app_employee_id() AND "status" = 'PENDING'))
  WITH CHECK (app_has_scope('attendance_manage') OR ("employeeId" = app_employee_id() AND "status" IN ('PENDING', 'CANCELLED')));
GRANT SELECT, INSERT, UPDATE ON "attendance_correction" TO sania_rls;

ALTER TABLE "attendance_policy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_policy_rls_read" ON "attendance_policy" FOR SELECT TO sania_rls USING (true);
CREATE POLICY "attendance_policy_rls_write" ON "attendance_policy" FOR UPDATE TO sania_rls
  USING (app_has_scope('policy_manage')) WITH CHECK (app_has_scope('policy_manage'));
GRANT SELECT, UPDATE ON "attendance_policy" TO sania_rls;

ALTER TABLE "holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holiday_rls_read" ON "holiday" FOR SELECT TO sania_rls USING (true);
CREATE POLICY "holiday_rls_insert" ON "holiday" FOR INSERT TO sania_rls WITH CHECK (app_has_scope('policy_manage'));
CREATE POLICY "holiday_rls_delete" ON "holiday" FOR DELETE TO sania_rls USING (app_has_scope('policy_manage'));
GRANT SELECT, INSERT, DELETE ON "holiday" TO sania_rls;
