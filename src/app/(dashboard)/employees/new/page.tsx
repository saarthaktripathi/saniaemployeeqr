import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listDepartments } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/primitives";
import { EmployeeForm } from "@/components/employees/employee-form";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const { actor, ctx } = await requirePageActor("employee:create");
  const [departments, settings] = await Promise.all([listDepartments(db, actor, ctx), getSettings(db)]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Employee records"
        title="Add employee"
        description={`A unique employee ID (${settings.employeeIdPrefix}-${new Date().getUTCFullYear()}-###) is assigned automatically when you save.`}
      />
      <EmployeeForm mode={{ kind: "create" }} departments={departments} defaultValidityDays={settings.defaultIdValidityDays} />
    </div>
  );
}
