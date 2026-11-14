-- Group-wide Employee Directory: companies, employment details, reporting lines,
-- attendance/leave references, exit details, employment history, compensation and documents.
-- Additive: existing employees are assigned to the group's primary company (named after
-- System Rules company name) and get a "Joined" history entry. No existing data changes.

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'CONSULTANT', 'INTERN');
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'REMOTE', 'HYBRID');
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'CONTRACT_END', 'RETIREMENT', 'OTHER');
CREATE TYPE "CompensationType" AS ENUM ('SALARY', 'STIPEND', 'FEE');
CREATE TYPE "PayFrequency" AS ENUM ('ANNUAL', 'MONTHLY', 'HOURLY');
CREATE TYPE "DocumentCategory" AS ENUM ('OFFER_LETTER', 'APPOINTMENT_LETTER', 'CONTRACT', 'ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'EXPERIENCE', 'RELIEVING_LETTER', 'PAYSLIP', 'OTHER');
CREATE TYPE "HistoryKind" AS ENUM ('JOINED', 'DESIGNATION', 'DEPARTMENT', 'COMPANY', 'MANAGER', 'EMPLOYMENT_TYPE', 'WORK_MODE', 'LOCATION', 'EXITED', 'REJOINED', 'NOTE');

-- AlterEnum (the new value is not used in this migration)
ALTER TYPE "UserRole" ADD VALUE 'MANAGEMENT';

-- Companies of the group
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_name_lower_key" ON "company" (lower("name"));

-- The primary company, named after the existing System Rules.
INSERT INTO "company" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."companyName", s."employeeIdPrefix", true, timezone('UTC', now()), timezone('UTC', now())
FROM "company_settings" s WHERE s."id" = 1;
INSERT INTO "company" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Sania Job Bowl', 'SJB', true, timezone('UTC', now()), timezone('UTC', now())
WHERE NOT EXISTS (SELECT 1 FROM "company");

-- Employee: new columns (companyId backfilled before it becomes NOT NULL)
ALTER TABLE "employee" ADD COLUMN     "attendanceRef" TEXT,
ADD COLUMN     "companyId" UUID,
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "exitDate" DATE,
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "exitType" "ExitType",
ADD COLUMN     "leavePolicy" TEXT,
ADD COLUMN     "leaveSystemUrl" TEXT,
ADD COLUMN     "reportingManagerId" UUID,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "workMode" "WorkMode";

UPDATE "employee" SET "companyId" = (SELECT "id" FROM "company" ORDER BY "createdAt", "id" LIMIT 1);
ALTER TABLE "employee" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_not_self_ck" CHECK ("reportingManagerId" IS NULL OR "reportingManagerId" <> "id");
ALTER TABLE "employee" ADD CONSTRAINT "employee_exit_details_ck" CHECK ("exitDate" IS NOT NULL OR ("exitType" IS NULL AND "exitReason" IS NULL));

-- CreateTable
CREATE TABLE "employee_compensation" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "CompensationType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "frequency" "PayFrequency" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "employee_compensation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_compensation_amount_ck" CHECK ("amount" >= 0)
);

-- CreateTable
CREATE TABLE "employee_document" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "employee_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_document_blob" (
    "documentId" UUID NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "employee_document_blob_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "employment_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "HistoryKind" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "employment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_compensation_employeeId_effectiveFrom_idx" ON "employee_compensation"("employeeId", "effectiveFrom");
CREATE INDEX "employee_document_employeeId_uploadedAt_idx" ON "employee_document"("employeeId", "uploadedAt");
CREATE INDEX "employment_history_employeeId_effectiveDate_idx" ON "employment_history"("employeeId", "effectiveDate");
CREATE INDEX "employee_companyId_idx" ON "employee"("companyId");
CREATE INDEX "employee_jobTitle_idx" ON "employee"("jobTitle");
CREATE INDEX "employee_reportingManagerId_idx" ON "employee"("reportingManagerId");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee" ADD CONSTRAINT "employee_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_document_blob" ADD CONSTRAINT "employee_document_blob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "employee_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Start every existing employee's timeline with a "Joined" entry.
INSERT INTO "employment_history" ("id", "employeeId", "kind", "effectiveDate", "toValue", "manual", "createdAt")
SELECT gen_random_uuid(), e."id", 'JOINED', coalesce(e."joiningDate", e."createdAt"::date),
       e."jobTitle" || ' · ' || e."department" || ' · ' || c."name", false, timezone('UTC', now())
FROM "employee" e JOIN "company" c ON c."id" = e."companyId";
