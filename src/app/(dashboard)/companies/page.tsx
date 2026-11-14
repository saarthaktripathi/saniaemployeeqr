import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { PageHeader } from "@/components/ui/primitives";
import { CompaniesManager } from "@/components/companies/companies-manager";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const { actor, ctx } = await requirePageActor("company:manage");
  const companies = await listCompanies(db, actor, ctx);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Owner controls"
        title="Group Companies"
        description="Every employee belongs to one company of the Sania group. Employee IDs stay unique across the whole group, and the company is shown on ID cards and the verification page."
      />
      <CompaniesManager companies={companies} />
    </div>
  );
}
