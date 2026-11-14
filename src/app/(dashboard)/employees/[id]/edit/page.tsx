import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getEmployee, listDirectoryOptions } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { AppError } from "@/lib/errors";
import { toIsoDate } from "@/features/shared/schema";
import { employeePhotoUrl } from "@/features/employees/photo";
import { PageHeader } from "@/components/ui/primitives";
import { EmployeeForm } from "@/components/employees/employee-form";

export const metadata: Metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("employee:update");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  if (employee.archivedAt) redirect(`/employees/${id}`);
  const [options, settings] = await Promise.all([listDirectoryOptions(db, actor, ctx), getSettings(db)]);
  const m = employee.reportingManager;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={employee.employeeCode} title={`Edit ${employee.displayName}`} description="The employee ID never changes. Edits are recorded in the audit log, and job changes in the employment history." />
      <EmployeeForm
        mode={{ kind: "edit", id, version: employee.version, exited: employee.exitDate !== null }}
        options={options}
        defaultValidityDays={settings.defaultIdValidityDays}
        photoUrl={employee.photoKey ? employeePhotoUrl(id, employee.photoUpdatedAt, "full") : null}
        initialManager={
          m ? { id: m.id, displayName: m.displayName, employeeCode: m.employeeCode, jobTitle: m.jobTitle, photoUpdatedAt: m.photoKey && m.photoUpdatedAt ? m.photoUpdatedAt.toISOString() : null } : null
        }
        initial={{
          firstName: employee.firstName,
          lastName: employee.lastName,
          displayName: employee.displayName === [employee.firstName, employee.lastName].filter(Boolean).join(" ") ? "" : employee.displayName,
          workEmail: employee.workEmail ?? "",
          phone: employee.phone ?? "",
          companyId: employee.companyId,
          department: employee.department,
          jobTitle: employee.jobTitle,
          businessVertical: employee.businessVertical ?? "",
          employmentType: employee.employmentType ?? "",
          workMode: employee.workMode ?? "",
          workLocation: employee.workLocation ?? "",
          team: employee.team ?? "",
          reportingManagerId: employee.reportingManagerId ?? "",
          attendanceRef: employee.attendanceRef ?? "",
          leavePolicy: employee.leavePolicy ?? "",
          leaveSystemUrl: employee.leaveSystemUrl ?? "",
          joiningDate: toIsoDate(employee.joiningDate),
          idIssueDate: toIsoDate(employee.idIssueDate),
          idExpiresAt: toIsoDate(employee.idExpiresAt),
          exitDate: toIsoDate(employee.exitDate),
          exitType: employee.exitType ?? "",
          exitReason: employee.exitReason ?? "",
        }}
      />
    </div>
  );
}
