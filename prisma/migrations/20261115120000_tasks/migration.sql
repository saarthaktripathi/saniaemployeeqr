-- Tasks: tasks, per-assignee assignments, private comment threads, files, append-only history.
-- Additive only. See docs/DATABASE_DESIGN.md section 2.3.

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskTarget" AS ENUM ('INDIVIDUAL', 'MULTIPLE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "TaskFileKind" AS ENUM ('BRIEF', 'DELIVERABLE');

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "target" "TaskTarget" NOT NULL DEFAULT 'INDIVIDUAL',
    "department" TEXT,
    "startDate" DATE,
    "dueDate" DATE,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_file" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "assignmentId" UUID,
    "kind" "TaskFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_file_blob" (
    "fileId" UUID NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "task_file_blob_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "task_history" (
    "id" BIGSERIAL NOT NULL,
    "taskId" UUID NOT NULL,
    "assignmentId" UUID,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "progress" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_number_key" ON "task"("number");

-- CreateIndex
CREATE INDEX "task_createdById_createdAt_idx" ON "task"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "task_dueDate_idx" ON "task"("dueDate");

-- CreateIndex
CREATE INDEX "task_assignment_employeeId_status_idx" ON "task_assignment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "task_assignment_status_idx" ON "task_assignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignment_taskId_employeeId_key" ON "task_assignment"("taskId", "employeeId");

-- CreateIndex
CREATE INDEX "task_comment_assignmentId_createdAt_idx" ON "task_comment"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "task_file_taskId_idx" ON "task_file"("taskId");

-- CreateIndex
CREATE INDEX "task_file_assignmentId_idx" ON "task_file"("assignmentId");

-- CreateIndex
CREATE INDEX "task_history_taskId_createdAt_idx" ON "task_history"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "task_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "task_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_file_blob" ADD CONSTRAINT "task_file_blob_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "task_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints and triggers
-- ---------------------------------------------------------------------------

ALTER TABLE "task" ADD CONSTRAINT "task_dates_ck" CHECK ("dueDate" IS NULL OR "startDate" IS NULL OR "dueDate" >= "startDate");
ALTER TABLE "task" ADD CONSTRAINT "task_department_ck" CHECK ("target" <> 'DEPARTMENT' OR "department" IS NOT NULL);
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_progress_ck" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_kind_ck" CHECK (("kind" = 'BRIEF') = ("assignmentId" IS NULL));
ALTER TABLE "task_file" ADD CONSTRAINT "task_file_size_ck" CHECK ("size" > 0 AND "size" <= 5242880);

CREATE TRIGGER task_history_no_update BEFORE UPDATE ON "task_history"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_mutation();
CREATE TRIGGER task_history_no_delete BEFORE DELETE ON "task_history"
  FOR EACH ROW EXECUTE FUNCTION append_only_block_mutation();

-- Open work per assignee (board and overdue queries).
CREATE INDEX "task_assignment_open_idx" ON "task_assignment" ("employeeId")
  WHERE "status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- Row-level security. Helpers are SECURITY DEFINER so policies on related tables do not
-- recurse into each other.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_task_owned(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "task" WHERE "id" = t AND "createdById" = app_user_id())
$$;

CREATE OR REPLACE FUNCTION app_assignment_visible(a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "task_assignment" x
    WHERE x."id" = a AND (app_has_scope('task') OR app_can_see_employee(x."employeeId") OR app_task_owned(x."taskId"))
  )
$$;

CREATE OR REPLACE FUNCTION app_task_visible(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_has_scope('task') OR app_task_owned(t) OR EXISTS (
    SELECT 1 FROM "task_assignment" x WHERE x."taskId" = t AND app_can_see_employee(x."employeeId")
  )
$$;

ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_rls_read" ON "task" FOR SELECT TO sania_rls USING (app_task_visible("id"));
CREATE POLICY "task_rls_insert" ON "task" FOR INSERT TO sania_rls WITH CHECK ("createdById" = app_user_id());
CREATE POLICY "task_rls_update" ON "task" FOR UPDATE TO sania_rls
  USING (app_has_scope('task_manage') OR "createdById" = app_user_id())
  WITH CHECK (app_has_scope('task_manage') OR "createdById" = app_user_id());
GRANT SELECT, INSERT, UPDATE ON "task" TO sania_rls;
GRANT USAGE ON SEQUENCE "task_number_seq" TO sania_rls;

ALTER TABLE "task_assignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_assignment_rls_read" ON "task_assignment" FOR SELECT TO sania_rls
  USING (app_has_scope('task') OR app_can_see_employee("employeeId") OR app_task_owned("taskId"));
CREATE POLICY "task_assignment_rls_insert" ON "task_assignment" FOR INSERT TO sania_rls
  WITH CHECK (app_has_scope('task_manage') OR app_task_owned("taskId"));
CREATE POLICY "task_assignment_rls_update" ON "task_assignment" FOR UPDATE TO sania_rls
  USING ("employeeId" = app_employee_id() OR app_has_scope('task_manage') OR app_task_owned("taskId"))
  WITH CHECK ("employeeId" = app_employee_id() OR app_has_scope('task_manage') OR app_task_owned("taskId"));
GRANT SELECT, INSERT, UPDATE ON "task_assignment" TO sania_rls;

ALTER TABLE "task_comment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_comment_rls_read" ON "task_comment" FOR SELECT TO sania_rls USING (app_assignment_visible("assignmentId"));
CREATE POLICY "task_comment_rls_insert" ON "task_comment" FOR INSERT TO sania_rls
  WITH CHECK ("authorId" = app_user_id() AND app_assignment_visible("assignmentId"));
GRANT SELECT, INSERT ON "task_comment" TO sania_rls;

ALTER TABLE "task_file" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_file_rls_read" ON "task_file" FOR SELECT TO sania_rls
  USING (CASE WHEN "assignmentId" IS NULL THEN app_task_visible("taskId") ELSE app_assignment_visible("assignmentId") END);
CREATE POLICY "task_file_rls_insert" ON "task_file" FOR INSERT TO sania_rls
  WITH CHECK ("uploadedById" = app_user_id() AND CASE WHEN "assignmentId" IS NULL THEN (app_has_scope('task_manage') OR app_task_owned("taskId")) ELSE app_assignment_visible("assignmentId") END);
CREATE POLICY "task_file_rls_update" ON "task_file" FOR UPDATE TO sania_rls
  USING ("uploadedById" = app_user_id()) WITH CHECK ("uploadedById" = app_user_id());
CREATE POLICY "task_file_rls_delete" ON "task_file" FOR DELETE TO sania_rls
  USING ("uploadedById" = app_user_id() OR app_has_scope('task_manage'));
GRANT SELECT, INSERT, UPDATE, DELETE ON "task_file" TO sania_rls;

ALTER TABLE "task_file_blob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_file_blob_rls_read" ON "task_file_blob" FOR SELECT TO sania_rls
  USING (EXISTS (SELECT 1 FROM "task_file" f WHERE f."id" = "fileId"));
CREATE POLICY "task_file_blob_rls_insert" ON "task_file_blob" FOR INSERT TO sania_rls
  WITH CHECK (EXISTS (SELECT 1 FROM "task_file" f WHERE f."id" = "fileId" AND f."uploadedById" = app_user_id()));
CREATE POLICY "task_file_blob_rls_delete" ON "task_file_blob" FOR DELETE TO sania_rls
  USING (EXISTS (SELECT 1 FROM "task_file" f WHERE f."id" = "fileId"));
GRANT SELECT, INSERT, DELETE ON "task_file_blob" TO sania_rls;

ALTER TABLE "task_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_history_rls_read" ON "task_history" FOR SELECT TO sania_rls USING (app_task_visible("taskId"));
CREATE POLICY "task_history_rls_insert" ON "task_history" FOR INSERT TO sania_rls WITH CHECK (app_task_visible("taskId"));
GRANT SELECT, INSERT ON "task_history" TO sania_rls;
GRANT USAGE ON SEQUENCE "task_history_id_seq" TO sania_rls;
