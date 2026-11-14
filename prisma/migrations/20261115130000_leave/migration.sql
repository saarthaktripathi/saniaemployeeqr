-- Leave: configurable leave types (seeded) and leave requests with an overlap guard.
-- Additive only. See docs/DATABASE_DESIGN.md section 2.4.

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'CLARIFICATION', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveHalfDay" AS ENUM ('NONE', 'FIRST_HALF', 'SECOND_HALF');

-- CreateTable
CREATE TABLE "leave_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "annualQuota" DECIMAL(5,1),
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" "LeaveHalfDay" NOT NULL DEFAULT 'NONE',
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "employeeNote" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_code_key" ON "leave_type"("code");

-- CreateIndex
CREATE INDEX "leave_request_employeeId_startDate_idx" ON "leave_request"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "leave_request_status_startDate_idx" ON "leave_request"("status", "startDate");

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints, seed data and RLS
-- ---------------------------------------------------------------------------

ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_quota_ck" CHECK ("annualQuota" IS NULL OR "annualQuota" BETWEEN 0 AND 366);
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_dates_ck" CHECK ("endDate" >= "startDate");
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_half_day_ck" CHECK ("halfDay" = 'NONE' OR "startDate" = "endDate");
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_days_ck" CHECK ("days" > 0);

-- No overlapping active requests for one employee.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_no_overlap"
  EXCLUDE USING gist ("employeeId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("status" IN ('PENDING', 'CLARIFICATION', 'APPROVED'));

-- Default leave types (editable under System Rules).
INSERT INTO "leave_type" ("id", "code", "name", "isPaid", "annualQuota", "allowHalfDay", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'CL', 'Casual leave', true, 12, true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SL', 'Sick leave', true, 12, true, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EL', 'Earned leave', true, 15, false, 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LOP', 'Unpaid leave (loss of pay)', false, NULL, true, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "leave_type" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_type_rls_read" ON "leave_type" FOR SELECT TO sania_rls USING (true);
CREATE POLICY "leave_type_rls_insert" ON "leave_type" FOR INSERT TO sania_rls WITH CHECK (app_has_scope('policy_manage'));
CREATE POLICY "leave_type_rls_update" ON "leave_type" FOR UPDATE TO sania_rls
  USING (app_has_scope('policy_manage')) WITH CHECK (app_has_scope('policy_manage'));
GRANT SELECT, INSERT, UPDATE ON "leave_type" TO sania_rls;

ALTER TABLE "leave_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_request_rls_read" ON "leave_request" FOR SELECT TO sania_rls
  USING (app_has_scope('leave') OR app_can_see_employee("employeeId"));
CREATE POLICY "leave_request_rls_insert" ON "leave_request" FOR INSERT TO sania_rls
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('leave_manage'));
CREATE POLICY "leave_request_rls_update" ON "leave_request" FOR UPDATE TO sania_rls
  USING (app_has_scope('leave_manage') OR ("employeeId" = app_employee_id() AND "status" IN ('PENDING', 'CLARIFICATION', 'APPROVED')))
  WITH CHECK (app_has_scope('leave_manage') OR ("employeeId" = app_employee_id() AND "status" IN ('PENDING', 'CLARIFICATION', 'CANCELLED')));
GRANT SELECT, INSERT, UPDATE ON "leave_request" TO sania_rls;
