import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getEmployee } from "@/server/services/employees";
import { getCredentialPreview } from "@/server/services/credentials";
import { getSettings } from "@/server/services/settings";
import { AppError } from "@/lib/errors";
import { Alert } from "@/components/ui/primitives";
import { IdCard } from "@/components/verification/id-card";
import { PrintButton } from "@/components/employees/print-button";

export const metadata: Metadata = { title: "Print ID card" };

export default async function IdCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("credential:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [preview, settings] = await Promise.all([getCredentialPreview(db, actor, id, ctx), getSettings(db)]);

  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link href={`/employees/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to employee
        </Link>
        {preview && <PrintButton />}
      </div>
      {!preview ? (
        <Alert tone="warning" title="No active QR credential">
          Issue a QR credential from the employee page before printing an ID card.
        </Alert>
      ) : (
        <>
          <IdCard
            qrSvg={preview.qrSvg}
            employee={{
              displayName: employee.displayName,
              employeeCode: employee.employeeCode,
              department: settings.publicShowDepartment ? employee.department : null,
              jobTitle: settings.publicShowJobTitle ? employee.jobTitle : null,
              businessVertical: settings.publicShowBusinessVertical ? employee.businessVertical : null,
              workLocation: settings.publicShowWorkLocation ? employee.workLocation : null,
              employmentStatus: employee.archivedAt ? "INACTIVE" : employee.employmentStatus,
              idIssueDate: employee.idIssueDate.toISOString().slice(0, 10),
              idExpiresAt: employee.idExpiresAt.toISOString().slice(0, 10),
            }}
          />
          <p className="mt-3 text-center text-xs text-ink-subtle">
            Scan the QR to check this ID&apos;s live status at {new URL(preview.url).host}. This card is company property.
          </p>
        </>
      )}
    </div>
  );
}
