import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Building2, ExternalLink, LockKeyhole, Pencil } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can, type Permission } from "@/server/authorization/permissions";
import { getEmployee } from "@/server/services/employees";
import { getCredentialPreview, getVerificationSummary } from "@/server/services/credentials";
import { listAudit } from "@/server/services/audit-read";
import { listHistory } from "@/server/services/history";
import { listDocuments } from "@/server/services/documents";
import { getSettings } from "@/server/services/settings";
import { AppError } from "@/lib/errors";
import { credentialState, idValidity } from "@/features/employees/rules";
import { EMPLOYMENT_TYPE_LABELS, EXIT_TYPE_LABELS, WORK_MODE_LABELS } from "@/features/employees/labels";
import { cn, formatDate, formatDateTime } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, DescriptionList } from "@/components/ui/primitives";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { CredentialBadge, EmploymentBadge, IdValidityBadge } from "@/components/employees/status-badges";
import { EmployeeStatusActions } from "@/components/employees/employee-status-actions";
import { CredentialPanel } from "@/components/employees/credential-panel";
import { HistoryTimeline } from "@/components/employees/history-timeline";
import { DocumentsPanel } from "@/components/employees/documents-panel";
import { CompensationPanel } from "@/components/employees/compensation-panel";
import { AuditList } from "@/components/audit/audit-list";
import { RESULT_LABELS } from "@/components/dashboard/stat-cards";

export const metadata: Metadata = { title: "Employee details" };

const TABS: { key: string; label: string; permission?: Permission; restricted?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "Employment history" },
  { key: "documents", label: "Documents", permission: "document:read", restricted: true },
  { key: "compensation", label: "Compensation", permission: "compensation:read", restricted: true },
  { key: "activity", label: "Activity", permission: "audit:read" },
];

const photoStamp = (p: { photoKey: string | null; photoUpdatedAt: Date | null }) => (p.photoKey && p.photoUpdatedAt ? p.photoUpdatedAt.toISOString() : null);

function PersonLink({ person, sub }: { person: { id: string; displayName: string; employeeCode: string; jobTitle: string; photoKey: string | null; photoUpdatedAt: Date | null }; sub?: ReactNode }) {
  return (
    <Link href={`/employees/${person.id}`} className="group inline-flex min-w-0 items-center gap-2.5">
      <EmployeeAvatar id={person.id} name={person.displayName} photoUpdatedAt={photoStamp(person)} size="sm" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink group-hover:text-primary-600">{person.displayName}</span>
        <span className="block truncate text-xs text-ink-subtle">{sub ?? `${person.employeeCode} · ${person.jobTitle}`}</span>
      </span>
    </Link>
  );
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("employee:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const tabs = TABS.filter((t) => !t.permission || can(actor, t.permission));
  const requested = (await searchParams).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? "overview";

  const settings = await getSettings(db);
  const archived = employee.archivedAt !== null;
  const exited = employee.exitDate !== null;
  const validity = idValidity(employee.idExpiresAt, settings.expiryWarningDays);
  const live = employee.credentials.find((c) => !c.revokedAt) ?? null;
  const canCred = can(actor, "credential:read");

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/dashboard" className="no-print mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Employee Directory
      </Link>
      <div className="animate-fade mb-4 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-primary-100 bg-[radial-gradient(120%_140%_at_0%_0%,#eef2ff_0%,#f3efff_38%,#e6f7fb_72%,#ffffff_100%)] px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <EmployeeAvatar id={id} name={employee.displayName} photoUpdatedAt={photoStamp(employee)} size="lg" className="shadow-md ring-4" />
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold tracking-wider text-violet-600">{employee.employeeCode}</p>
            <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-ink">{employee.displayName}</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              {employee.jobTitle} · {employee.department}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Building2 className="size-3.5 text-primary-600" aria-hidden />
              {employee.company.name}
              {employee.employmentType && <Badge dot={false}>{EMPLOYMENT_TYPE_LABELS[employee.employmentType]}</Badge>}
              {employee.workMode && <Badge dot={false}>{WORK_MODE_LABELS[employee.workMode]}</Badge>}
            </p>
          </div>
        </div>
        {can(actor, "employee:update") && !archived && (
          <ButtonLink href={`/employees/${id}/edit`} variant="secondary">
            <Pencil className="size-4" aria-hidden /> Edit
          </ButtonLink>
        )}
      </div>

      <nav aria-label="Employee sections" className="no-print mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white bg-white/70 p-1 shadow-[0_2px_10px_rgb(30_41_90/0.05)]">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/employees/${id}` : `/employees/${id}?tab=${t.key}`}
            scroll={false}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              t.key === tab ? "bg-gradient-to-b from-primary-500 to-primary-600 text-white shadow-sm" : "text-ink-muted hover:bg-navy-100/70 hover:text-ink",
            )}
          >
            {t.restricted && <LockKeyhole className="size-3.5" aria-hidden />}
            {t.label}
          </Link>
        ))}
      </nav>

      {archived && (
        <div className="mb-5">
          <Alert tone="neutral" title="Archived record">
            Archived on {formatDateTime(employee.archivedAt)}. It is hidden from the directory and cannot verify publicly.
          </Alert>
        </div>
      )}

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-5">
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
                    exited={exited}
                    perms={{
                      deactivate: can(actor, "employee:deactivate"),
                      reactivate: can(actor, "employee:reactivate"),
                      archive: can(actor, "employee:archive"),
                      delete: can(actor, "employee:delete"),
                    }}
                  />
                }
              />
              <div className="flex flex-wrap gap-2 px-5 pt-4">
                <EmploymentBadge status={employee.employmentStatus} archived={archived} exited={exited} />
                <IdValidityBadge validity={validity} />
                <CredentialBadge state={credentialState(live)} />
              </div>
              <div className="p-5">
                <DescriptionList
                  items={[
                    { label: "Date of joining", value: formatDate(employee.joiningDate) },
                    { label: "Employment status", value: exited ? "Exited" : employee.employmentStatus === "ACTIVE" ? "Active" : "Inactive" },
                    { label: "ID issued", value: formatDate(employee.idIssueDate) },
                    { label: "ID valid until", value: formatDate(employee.idExpiresAt) },
                    ...(exited
                      ? [
                          { label: "Exit date", value: formatDate(employee.exitDate) },
                          { label: "Exit type", value: employee.exitType ? EXIT_TYPE_LABELS[employee.exitType] : "—" },
                          { label: "Exit reason", value: employee.exitReason },
                        ]
                      : []),
                  ]}
                />
              </div>
            </Card>

            <Card>
              <CardHeader eyebrow="Organisation" title="Company, role & reporting" />
              <div className="p-5">
                <DescriptionList
                  items={[
                    { label: "Company", value: employee.company.name + (employee.company.isActive ? "" : " (inactive)") },
                    { label: "Business vertical", value: employee.businessVertical },
                    { label: "Department", value: employee.department },
                    { label: "Designation", value: employee.jobTitle },
                    { label: "Employment type", value: employee.employmentType ? EMPLOYMENT_TYPE_LABELS[employee.employmentType] : null },
                    { label: "Team", value: employee.team },
                    { label: "Work mode", value: employee.workMode ? WORK_MODE_LABELS[employee.workMode] : null },
                    { label: "Work location", value: employee.workLocation },
                    {
                      label: "Reporting manager",
                      value: employee.reportingManager ? (
                        <PersonLink person={employee.reportingManager} sub={employee.reportingManager.archivedAt ? "Archived record" : undefined} />
                      ) : null,
                    },
                  ]}
                />
              </div>
              <div className="border-t border-border px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Direct reports ({employee._count.directReports})</p>
                  {employee._count.directReports > 0 && (
                    <Link href={`/dashboard?manager=${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline">
                      View team in directory <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
                {employee.directReports.length === 0 ? (
                  <p className="text-sm text-ink-subtle">Nobody reports to {employee.firstName}.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2" data-testid="direct-reports">
                    {employee.directReports.map((r) => (
                      <li key={r.id}>
                        <PersonLink person={r} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader eyebrow="Contact & attendance" title="Contact, attendance and leave" description="Private — never shown on the public verification page or exported (phone)." />
              <div className="p-5">
                <DescriptionList
                  items={[
                    {
                      label: "Official email ID",
                      value: employee.workEmail ? (
                        <a href={`mailto:${employee.workEmail}`} className="text-primary-600 hover:underline">
                          {employee.workEmail}
                        </a>
                      ) : null,
                    },
                    {
                      label: "Contact number",
                      value: employee.phone ? (
                        <a href={`tel:${employee.phone.replace(/[^+\d]/g, "")}`} className="text-primary-600 hover:underline">
                          {employee.phone}
                        </a>
                      ) : null,
                    },
                    { label: "Attendance / biometric ID", value: employee.attendanceRef },
                    { label: "Leave policy", value: employee.leavePolicy },
                    {
                      label: "Leave / attendance record",
                      value: employee.leaveSystemUrl ? (
                        <a href={employee.leaveSystemUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                          Open in HR system <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ) : null,
                    },
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

            <p className="text-xs text-ink-subtle">
              Created {formatDateTime(employee.createdAt)}
              {employee.createdBy ? ` by ${employee.createdBy.name}` : ""} · Last updated {formatDateTime(employee.updatedAt)}
              {employee.updatedBy ? ` by ${employee.updatedBy.name}` : ""} · Revision {employee.version}
            </p>
          </div>

          <div id="credential" className="min-w-0 scroll-mt-24 space-y-5">
            {canCred ? <CredentialSide id={id} archived={archived} inactive={employee.employmentStatus !== "ACTIVE"} actor={actor} ctx={ctx} /> : (
              <Card className="p-5 text-sm text-ink-muted">You don&apos;t have permission to view QR credentials.</Card>
            )}
          </div>
        </div>
      )}

      {tab === "history" && <HistoryTimeline employeeId={id} rows={await listHistory(db, actor, id, ctx)} canEdit={can(actor, "employee:update")} />}

      {tab === "documents" && <DocumentsPanel employeeId={id} documents={await listDocuments(db, actor, id, ctx)} canManage={can(actor, "document:manage")} />}

      {tab === "compensation" && <CompensationPanel employeeId={id} canManage={can(actor, "compensation:manage")} />}

      {tab === "activity" && (
        <Card>
          <CardHeader eyebrow="Audit" title="Activity on this record" description="Newest first. Personal data values are not stored in event details — only field names." />
          <AuditList rows={(await listAudit(db, actor, { targetId: id, limit: 50 }, ctx)).rows} compact />
        </Card>
      )}
    </div>
  );
}

/** QR panel plus verification details (scans of this employee's QR). */
async function CredentialSide({ id, archived, inactive, actor, ctx }: { id: string; archived: boolean; inactive: boolean; actor: Parameters<typeof getCredentialPreview>[1]; ctx: Parameters<typeof getCredentialPreview>[3] }) {
  const [preview, summary] = await Promise.all([getCredentialPreview(db, actor, id, ctx), getVerificationSummary(db, actor, id, ctx)]);
  return (
    <>
      <CredentialPanel
        employeeId={id}
        archived={archived}
        inactive={inactive}
        preview={preview ? { id: preview.id, url: preview.url, qrSvg: preview.qrSvg, issuedAt: preview.issuedAt.toISOString(), expiresAt: preview.expiresAt.toISOString(), state: preview.state } : null}
        perms={{ issue: can(actor, "credential:issue"), revoke: can(actor, "credential:revoke") }}
      />
      <Card>
        <CardHeader eyebrow="Verification" title="Verification details" />
        <dl className="grid grid-cols-2 gap-4 p-5 text-sm" data-testid="verification-summary">
          <div>
            <dt className="text-xs text-ink-subtle">QR scans, last 30 days</dt>
            <dd className="text-2xl font-bold text-ink tabular-nums">{summary.last30Days.toLocaleString("en-IN")}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Last checked</dt>
            <dd className="font-medium text-ink">{summary.lastCheckedAt ? formatDateTime(summary.lastCheckedAt) : "Never"}</dd>
            {summary.lastResult && <dd className="text-xs text-ink-muted">Result: {RESULT_LABELS[summary.lastResult] ?? summary.lastResult}</dd>}
          </div>
        </dl>
      </Card>
    </>
  );
}
