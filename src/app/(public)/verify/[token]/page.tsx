import type { Metadata } from "next";
import { headers } from "next/headers";
import { Info } from "lucide-react";
import { db } from "@/server/db/client";
import { requestContextFromHeaders } from "@/server/auth/request";
import { verifyToken } from "@/server/services/verification";
import { renderQrSvg, verificationUrl } from "@/server/services/credentials";
import { Card } from "@/components/ui/primitives";
import { IdCard, StatusBanner } from "@/components/verification/id-card";
import { VerifyActions } from "@/components/verification/verify-actions";

export const metadata: Metadata = {
  title: "Employee verification",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await verifyToken(db, token, requestContextFromHeaders(await headers()));
  // Only render a QR for credentials we actually issued (never echo arbitrary input).
  const url = view.employee ? verificationUrl(token) : null;
  const qrSvg = url && view.status !== "REVOKED" ? await renderQrSvg(url) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="no-print text-xs font-semibold tracking-wider text-teal-700 uppercase">Employee verification</p>
      <h1 className="no-print mt-1 mb-6 text-2xl font-semibold tracking-tight text-navy-900">{view.company.name} credential check</h1>

      <div className="space-y-5">
        <StatusBanner status={view.status} checkedAt={view.checkedAt} />

        {view.employee && <IdCard employee={view.employee} status={view.status} qrSvg={qrSvg} />}

        {view.employee && view.credentialExpiresAt && (
          <p className="text-xs text-ink-muted">
            QR credential valid until {new Date(view.credentialExpiresAt).toUTCString()}.
          </p>
        )}

        {url && <VerifyActions url={url} />}

        <Card className="no-print flex gap-3 p-4 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden />
          <p>
            <span className="font-semibold text-ink">About this result.</span> A valid QR credential confirms the current state of this record in{" "}
            {view.company.name}&apos;s HR system at the time shown. It does not by itself prove that the person holding the ID is the employee
            named — compare against a photo ID where identity matters. Only company-approved fields are displayed.
          </p>
        </Card>
      </div>
    </div>
  );
}
