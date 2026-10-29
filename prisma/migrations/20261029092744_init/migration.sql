-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'HR_ADMIN', 'HR_STAFF');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('VERIFIED', 'INACTIVE', 'ID_EXPIRED', 'CREDENTIAL_EXPIRED', 'REVOKED', 'UNKNOWN', 'MALFORMED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'HR_STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL,
    "workEmail" TEXT,
    "phone" TEXT,
    "department" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "businessVertical" TEXT,
    "workLocation" TEXT,
    "joiningDate" DATE,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "idIssueDate" DATE NOT NULL,
    "idExpiresAt" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_code_counter" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employee_code_counter_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateTable
CREATE TABLE "employee_credential" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "issuedById" TEXT,
    "revokedById" TEXT,

    CONSTRAINT "employee_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "requestId" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_event" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "VerificationResult" NOT NULL,
    "credentialId" UUID,
    "employeeId" UUID,
    "ipHash" TEXT,

    CONSTRAINT "verification_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT NOT NULL DEFAULT 'Sania Job Bowl',
    "tagline" TEXT NOT NULL DEFAULT 'Connecting Talent. Creating the Future.',
    "employeeIdPrefix" TEXT NOT NULL DEFAULT 'SJB',
    "defaultIdValidityDays" INTEGER NOT NULL DEFAULT 365,
    "credentialValidityDays" INTEGER NOT NULL DEFAULT 365,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "publicShowJobTitle" BOOLEAN NOT NULL DEFAULT true,
    "publicShowBusinessVertical" BOOLEAN NOT NULL DEFAULT true,
    "publicShowWorkLocation" BOOLEAN NOT NULL DEFAULT true,
    "publicShowDepartment" BOOLEAN NOT NULL DEFAULT true,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "verificationRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "requireMfaForPrivileged" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor"("secret");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_employeeCode_key" ON "employee"("employeeCode");

-- CreateIndex
CREATE INDEX "employee_employmentStatus_idx" ON "employee"("employmentStatus");

-- CreateIndex
CREATE INDEX "employee_department_idx" ON "employee"("department");

-- CreateIndex
CREATE INDEX "employee_idExpiresAt_idx" ON "employee"("idExpiresAt");

-- CreateIndex
CREATE INDEX "employee_archivedAt_idx" ON "employee"("archivedAt");

-- CreateIndex
CREATE INDEX "employee_createdAt_id_idx" ON "employee"("createdAt", "id");

-- CreateIndex
CREATE INDEX "employee_displayName_idx" ON "employee"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "employee_credential_tokenHash_key" ON "employee_credential"("tokenHash");

-- CreateIndex
CREATE INDEX "employee_credential_employeeId_issuedAt_idx" ON "employee_credential"("employeeId", "issuedAt");

-- CreateIndex
CREATE INDEX "employee_credential_expiresAt_idx" ON "employee_credential"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_targetType_targetId_createdAt_idx" ON "audit_log"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "verification_event_createdAt_idx" ON "verification_event"("createdAt");

-- CreateIndex
CREATE INDEX "verification_event_employeeId_createdAt_idx" ON "verification_event"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_event_createdAt_idx" ON "outbox_event"("createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_credential" ADD CONSTRAINT "employee_credential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_credential" ADD CONSTRAINT "employee_credential_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_credential" ADD CONSTRAINT "employee_credential_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_event" ADD CONSTRAINT "verification_event_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "employee_credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_event" ADD CONSTRAINT "verification_event_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints and triggers (not expressible in Prisma schema)
-- ---------------------------------------------------------------------------

-- Work email unique (case-insensitive) when present.
CREATE UNIQUE INDEX "employee_work_email_lower_key" ON "employee" (lower("workEmail")) WHERE "workEmail" IS NOT NULL;

-- At most one non-revoked credential per employee.
CREATE UNIQUE INDEX "employee_credential_one_live_per_employee" ON "employee_credential" ("employeeId") WHERE "revokedAt" IS NULL;

-- Case-insensitive search support for names and codes.
CREATE INDEX "employee_display_name_lower_idx" ON "employee" (lower("displayName") text_pattern_ops);
CREATE INDEX "employee_code_lower_idx" ON "employee" (lower("employeeCode") text_pattern_ops);

-- Audit log is append-only. Retention purges must opt in per transaction with:
--   SET LOCAL app.audit_purge = 'on';
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- Outbox: notify listeners. NOTIFY is delivered only when the transaction commits.
CREATE OR REPLACE FUNCTION outbox_event_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox_event', NEW."id"::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_event_after_insert AFTER INSERT ON "outbox_event"
  FOR EACH ROW EXECUTE FUNCTION outbox_event_notify();

-- Settings is a singleton row.
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_singleton" CHECK ("id" = 1);
INSERT INTO "company_settings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING;

-- Sanity checks.
ALTER TABLE "employee" ADD CONSTRAINT "employee_id_dates_ck" CHECK ("idExpiresAt" >= "idIssueDate");
ALTER TABLE "employee_code_counter" ADD CONSTRAINT "employee_code_counter_nonneg" CHECK ("lastValue" >= 0);
