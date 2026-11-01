import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { findDuplicateEmployees } from "@/server/services/employees";
import { PageHeader } from "@/components/ui/primitives";
import { ImportForm } from "@/components/employees/import-form";
import { DuplicateCleanup, type DuplicateGroupView } from "@/components/employees/duplicate-cleanup";

export const metadata: Metadata = { title: "Bulk import" };

export default async function ImportPage() {
  const { actor, ctx } = await requirePageActor("employee:create");
  const duplicates = can(actor, "employee:delete") ? await findDuplicateEmployees(db, actor, ctx) : null;
  const toView = (m: { id: string; employeeCode: string; createdAt: Date; hasCredential: boolean; archived: boolean }) => ({ ...m, createdAt: m.createdAt.toISOString() });
  const groups: DuplicateGroupView[] =
    duplicates?.groups.map((g) => ({ displayName: g.displayName, department: g.department, jobTitle: g.jobTitle, keep: toView(g.keep), extras: g.extras.map(toView) })) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Employee records"
        title="Bulk import"
        description="Create up to 500 employees from a CSV or Excel file. Every row is validated first — if any row has a problem, nothing is imported. Duplicates can be skipped or cleaned up below."
      />
      <div className="space-y-5">
        <ImportForm />
        {duplicates && <DuplicateCleanup groups={groups} extraCount={duplicates.extraCount} />}
      </div>
    </div>
  );
}
