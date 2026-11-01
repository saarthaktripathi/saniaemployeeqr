-- Employee profile photos (additive; no existing data changes)
ALTER TABLE "employee" ADD COLUMN "photoKey" TEXT,
ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);

ALTER TABLE "company_settings" ADD COLUMN "publicShowPhoto" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "employee_photo" (
    "employeeId" UUID NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_photo_pkey" PRIMARY KEY ("employeeId")
);

ALTER TABLE "employee_photo" ADD CONSTRAINT "employee_photo_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
