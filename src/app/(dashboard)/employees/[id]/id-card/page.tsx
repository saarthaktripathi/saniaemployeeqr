import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getEmployee } from "@/server/services/employees";
import { getCredentialPreview } from "@/server/services/credentials";
import { photoDataUrl } from "@/server/services/photos";
import { getSettings } from "@/server/services/settings";
import { AppError } from "@/lib/errors";
import { verificationOutcome } from "@/features/employees/rules";
import { Alert } from "@/components/ui/primitives";
import { logoSrc } from "@/components/layout/logo";
import { IdCardSvg } from "@/components/verification/id-card-svg";
import { IdCardExport } from "@/components/verification/id-card-export";
import { cardStatusOf } from "@/components/verification/status";

export const metadata: Metadata = { title: "Employee ID card" };

export default async function IdCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("credential:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [preview, settings, photo] = await Promise.all([getCredentialPreview(db, actor, id, ctx), getSettings(db), photoDataUrl(db, employee.photoKey)]);
  // Same decision the public page makes, so the printed status matches a scan.
  const status = preview ? verificationOutcome({ wellFormed: true, credential: { expiresAt: preview.expiresAt, revokedAt: null }, employee }) : null;

  return (
    <div className="mx-auto max-w-md">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link href={`/employees/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to employee
        </Link>
      </div>
      {!preview || !status ? (
        <Alert tone="warning" title="No active QR credential">
          Issue a QR credential from the employee page before printing an ID card.
        </Alert>
      ) : (
        <>
          <IdCardExport filename={`${employee.employeeCode}-id-card`}>
            <IdCardSvg
              data={{
                displayName: employee.displayName,
                employeeCode: employee.employeeCode,
                jobTitle: settings.publicShowJobTitle ? employee.jobTitle : null,
                department: settings.publicShowDepartment ? employee.department : null,
                idExpiresAt: employee.idExpiresAt.toISOString().slice(0, 10),
                photo,
              }}
              status={cardStatusOf(status)}
              qr={preview.qrPath}
              logoHref={logoSrc()}
              company={settings.companyName}
              tagline={settings.tagline}
              verifyHost={new URL(preview.url).host}
              className="mx-auto h-auto w-full max-w-[360px] drop-shadow-xl print:max-w-[54mm] print:drop-shadow-none"
            />
          </IdCardExport>
          <p className="no-print mt-3 text-center text-xs text-ink-subtle">
            Scanning the QR shows this employee&apos;s live status at {new URL(preview.url).host}. PNG and PDF are generated on your device.
          </p>
        </>
      )}
    </div>
  );
}
