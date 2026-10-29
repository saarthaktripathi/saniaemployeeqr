import type { Metadata } from "next";
import { requirePageActor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { ImportForm } from "@/components/employees/import-form";

export const metadata: Metadata = { title: "Bulk import" };

export default async function ImportPage() {
  await requirePageActor("employee:create");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Employee records"
        title="Bulk import"
        description="Create up to 500 employees from a CSV file. Every row is validated first — if any row has a problem, nothing is imported."
      />
      <ImportForm />
    </div>
  );
}
