import type { Metadata } from "next";
import { Download, Plus } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { getDashboardStats, getDashboardTrends, withLivePoint } from "@/server/services/dashboard";
import { listDepartments, listEmployees } from "@/server/services/employees";
import { credentialState, idValidity } from "@/features/employees/rules";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";
import { Insights } from "@/components/dashboard/stat-cards";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { TeamIllustration } from "@/components/dashboard/team-illustration";
import { DirectoryProvider } from "@/components/employees/directory-context";
import { DirectoryFilters } from "@/components/employees/directory-filters";
import { DirectoryTable, type DirectoryRow } from "@/components/employees/directory-table";
import { Pagination } from "@/components/employees/pagination";

export const metadata: Metadata = { title: "Employee Directory" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor, ctx } = await requirePageActor("employee:read");
  const sp = await searchParams;
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));

  // One round trip each, in parallel; the list query is paginated and indexed in the database.
  const [stats, trends, result, departments] = await Promise.all([
    getDashboardStats(db, actor, ctx),
    getDashboardTrends(db, actor, ctx),
    listEmployees(db, actor, flat, ctx).catch(() => listEmployees(db, actor, {}, ctx)),
    listDepartments(db, actor, ctx),
  ]);

  const rows: DirectoryRow[] = result.rows.map((r) => ({
    id: r.id,
    employeeCode: r.employeeCode,
    displayName: r.displayName,
    department: r.department,
    jobTitle: r.jobTitle,
    employmentStatus: r.employmentStatus,
    archived: r.archivedAt !== null,
    idExpiresAt: r.idExpiresAt.toISOString().slice(0, 10),
    idValidity: idValidity(r.idExpiresAt, result.warnDays),
    credential: credentialState(r.credentials[0]),
    photoUpdatedAt: r.photoKey && r.photoUpdatedAt ? r.photoUpdatedAt.toISOString() : null,
  }));

  const perms = {
    update: can(actor, "employee:update"),
    deactivate: can(actor, "employee:deactivate"),
    reactivate: can(actor, "employee:reactivate"),
    archive: can(actor, "employee:archive"),
    delete: can(actor, "employee:delete"),
    credentialRead: can(actor, "credential:read"),
  };
  const exportQs = new URLSearchParams(flat as Record<string, string>);
  exportQs.delete("page");

  return (
    <DirectoryProvider>
      <PageHeader
        eyebrow="HR workspace"
        title="Employee Directory"
        description="All employee records and their credential status. Figures update live as your team makes changes."
        art={<TeamIllustration />}
        actions={
          <>
            {can(actor, "employee:export") && (
              <a
                href={`/api/employees/export?${exportQs}`}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-white px-4 text-sm font-medium text-ink shadow-xs transition-colors hover:bg-navy-100/50"
              >
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            )}
            {can(actor, "employee:create") && (
              <ButtonLink href="/employees/new">
                <Plus className="size-4" aria-hidden /> Add Employee
              </ButtonLink>
            )}
          </>
        }
      />
      <KpiCards stats={stats} trends={withLivePoint(trends, stats)} query={result.query} />
      <DirectoryFilters departments={departments} query={result.query} />
      <DirectoryTable
        rows={rows}
        perms={perms}
        total={result.total}
        canCreate={can(actor, "employee:create")}
        footer={<Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} params={flat as Record<string, string>} />}
      />
      <Insights stats={stats} />
    </DirectoryProvider>
  );
}
