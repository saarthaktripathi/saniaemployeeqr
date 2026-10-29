import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { getEmployee } from "@/server/services/employees";
import { getCredentialPreview } from "@/server/services/credentials";
import { listAudit } from "@/server/services/audit-read";
import { getSettings } from "@/server/services/settings";
import { AppError } from "@/lib/errors";
import { credentialState, idValidity } from "@/features/employees/rules";
import { formatDate, formatDateTime } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { CredentialBadge, EmploymentBadge, IdValidityBadge } from "@/components/employees/status-badges";
import { EmployeeStatusActions } from "@/components/employees/employee-status-actions";
import { CredentialPanel } from "@/components/employees/credential-panel";
import { AuditList } from "@/components/audit/audit-list";

export const metadata: Metadata = { title: "Employee details" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("employee:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const settings = await getSettings(db);
  const [preview, audit] = await Promise.all([
    can(actor, "credential:read") ? getCredentialPreview(db, actor, id, ctx) : null,
    can(actor, "audit:read") ? listAudit(db, actor, { targetId: id, limit: 15 }, ctx) : null,
  ]);
  const archived = employee.archivedAt !== null;
  const validity = idValidity(employee.idExpiresAt, settings.expiryWarningDays);
  const live = employee.credentials.find((c) => !c.revokedAt) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/dashboard" className="no-print mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Employee Directory
      </Link>
      <PageHeader
        eyebrow={employee.employeeCode}
        title={employee.displayName}
        description={`${employee.jobTitle} · ${employee.department}`}
        actions={
          can(actor, "employee:update") && !archived ? (
            <ButtonLink href={`/employees/${id}/edit`} variant="secondary">
              <Pencil className="size-4" aria-hidden /> Edit
            </ButtonLink>
          ) : undefined
        }
      />

      {archived && (
        <div className="mb-5">
          <Alert tone="neutral" title="Archived record">
            Archived on {formatDateTime(employee.archivedAt)}. It is hidden from the directory and cannot verify publicly.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              eyebrow="Status"
              title="Employment & ID validity"
              actions={
                <EmployeeStatusActions
                  id={id}
                  name={employee.displayName}
                  status={employee.employmentStatus}
                  archived={archived}
                  perms={{
                    deactivate: can(actor, "employee:deactivate"),
                    reactivate: can(actor, "employee:reactivate"),
                    archive: can(actor, "employee:archive"),
                  }}
                />
              }
            />
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              <EmploymentBadge status={employee.employmentStatus} archived={archived} />
              <IdValidityBadge validity={validity} />
              <CredentialBadge state={credentialState(live)} />
            </div>
            <div className="p-5">
              <DescriptionList
                items={[
                  { label: "ID issued", value: formatDate(employee.idIssueDate) },
                  { label: "ID valid until", value: formatDate(employee.idExpiresAt) },
                  { label: "Joining date", value: formatDate(employee.joiningDate) },
                  { label: "Employment status", value: employee.employmentStatus === "ACTIVE" ? "Active" : "Inactive" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Profile" title="Employee profile" description="Contact fields are private and never shown on the public verification page." />
            <div className="p-5">
              <DescriptionList
                items={[
                  { label: "First name", value: employee.firstName },
                  { label: "Last name", value: employee.lastName || "—" },
                  { label: "Department", value: employee.department },
                  { label: "Approved job title", value: employee.jobTitle },
                  { label: "Business vertical", value: employee.businessVertical },
                  { label: "Work location", value: employee.workLocation },
                  { label: "Work email", value: employee.workEmail },
                  { label: "Phone", value: employee.phone },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Credentials" title="QR credential history" description="Each issued QR is an independent credential. Reissuing revokes the previous one." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-page/60 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-2.5">Issued</th>
                    <th scope="col" className="px-5 py-2.5">Expires</th>
                    <th scope="col" className="px-5 py-2.5">State</th>
                    <th scope="col" className="px-5 py-2.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employee.credentials.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-ink-subtle">
                        No QR credentials issued yet.
                      </td>
                    </tr>
                  )}
                  {employee.credentials.map((c) => (
                    <tr key={c.id}>
                      <td className="px-5 py-2.5">
                        {formatDateTime(c.issuedAt)}
                        {c.issuedBy && <span className="block text-xs text-ink-subtle">by {c.issuedBy.name}</span>}
                      </td>
                      <td className="px-5 py-2.5">{formatDate(c.expiresAt)}</td>
                      <td className="px-5 py-2.5">
                        <CredentialBadge state={credentialState(c)} />
                      </td>
                      <td className="px-5 py-2.5 text-xs text-ink-muted">
                        {c.revokedAt ? `Revoked ${formatDateTime(c.revokedAt)}${c.revokedBy ? ` by ${c.revokedBy.name}` : ""} — ${c.revokeReason ?? ""}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {audit && (
            <Card>
              <CardHeader eyebrow="Audit" title="Recent activity on this record" />
              <AuditList rows={audit.rows} compact />
            </Card>
          )}

          <p className="text-xs text-ink-subtle">
            Created {formatDateTime(employee.createdAt)}
            {employee.createdBy ? ` by ${employee.createdBy.name}` : ""} · Last updated {formatDateTime(employee.updatedAt)}
            {employee.updatedBy ? ` by ${employee.updatedBy.name}` : ""} · Revision {employee.version}
          </p>
        </div>

        <div id="credential" className="scroll-mt-24">
          {can(actor, "credential:read") ? (
            <CredentialPanel
              employeeId={id}
              archived={archived}
              inactive={employee.employmentStatus !== "ACTIVE"}
              preview={preview ? { id: preview.id, url: preview.url, qrSvg: preview.qrSvg, issuedAt: preview.issuedAt.toISOString(), expiresAt: preview.expiresAt.toISOString(), state: preview.state } : null}
              perms={{ issue: can(actor, "credential:issue"), revoke: can(actor, "credential:revoke") }}
            />
          ) : (
            <Card className="p-5 text-sm text-ink-muted">You don&apos;t have permission to view QR credentials.</Card>
          )}
        </div>
      </div>
    </div>
  );
}
