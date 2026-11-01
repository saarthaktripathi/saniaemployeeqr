import type { Metadata } from "next";
import { headers } from "next/headers";
import { Info } from "lucide-react";
import { db } from "@/server/db/client";
import { requestContextFromHeaders } from "@/server/auth/request";
import { verifyToken } from "@/server/services/verification";
import { renderQrPath, verificationUrl } from "@/server/services/credentials";
import { logoSrc } from "@/components/layout/logo";
import { Card } from "@/components/ui/primitives";
import { StatusBanner } from "@/components/verification/id-card";
import { IdCardSvg } from "@/components/verification/id-card-svg";
import { cardStatusOf } from "@/components/verification/status";
import { VerifyActions } from "@/components/verification/verify-actions";
import { formatDate } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Employee verification",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The backend decides everything on every request; nothing here trusts client state.
  const view = await verifyToken(db, token, requestContextFromHeaders(await headers()));
  // Only draw a QR for credentials we actually issued (never echo arbitrary input).
  const url = view.employee ? verificationUrl(token) : null;
  const qr = url && view.status !== "REVOKED" ? renderQrPath(url) : null;
  const e = view.employee;

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-4xl sm:px-6 sm:py-10">
      <p className="no-print text-xs font-semibold tracking-wider text-teal-700 uppercase">Employee verification</p>
      <h1 className="no-print mt-1 mb-5 text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">{view.company.name} credential check</h1>

      {/* Phones: verdict → card → details. Wider screens: card on the left, verdict and details on the right. */}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,340px)_1fr] sm:items-start">
        <div className="sm:col-start-2 sm:row-start-1">
          <StatusBanner status={view.status} checkedAt={view.checkedAt} />
        </div>

        {e && (
          <div className="animate-rise mx-auto w-full max-w-[340px] sm:col-start-1 sm:row-span-2 sm:row-start-1" style={{ animationDelay: "60ms" }}>
            <IdCardSvg
              data={{ displayName: e.displayName, employeeCode: e.employeeCode, jobTitle: e.jobTitle, department: e.department, idExpiresAt: e.idExpiresAt, photo: e.photo }}
              status={cardStatusOf(view.status)}
              qr={qr}
              logoHref={logoSrc()}
              company={view.company.name}
              tagline={view.company.tagline}
              className="h-auto w-full drop-shadow-xl"
            />
          </div>
        )}

        <div className="space-y-5 sm:col-start-2">
          {e && (
            <Card className="no-print p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-xs text-ink-subtle">Employee</dt>
                  <dd className="font-semibold text-ink">{e.displayName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Employee ID</dt>
                  <dd className="font-mono font-semibold">{e.employeeCode}</dd>
                </div>
                {e.jobTitle && (
                  <div>
                    <dt className="text-xs text-ink-subtle">Designation</dt>
                    <dd>{e.jobTitle}</dd>
                  </div>
                )}
                {e.department && (
                  <div>
                    <dt className="text-xs text-ink-subtle">Department</dt>
                    <dd>{e.department}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-ink-subtle">ID valid until</dt>
                  <dd>{formatDate(e.idExpiresAt)}</dd>
                </div>
                {view.credentialExpiresAt && (
                  <div>
                    <dt className="text-xs text-ink-subtle">QR valid until</dt>
                    <dd>{formatDate(view.credentialExpiresAt)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
          {url && <VerifyActions url={url} />}
        </div>

        <Card className="no-print flex gap-3 p-4 text-sm text-ink-muted sm:col-span-2">
          <Info className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden />
          <p>
            <span className="font-semibold text-ink">About this result.</span> A valid QR credential confirms the current state of this record in{" "}
            {view.company.name}&apos;s HR system at the time shown. Compare the photo with the person presenting the card. Only company-approved
            fields are displayed.
          </p>
        </Card>
      </div>
    </div>
  );
}
