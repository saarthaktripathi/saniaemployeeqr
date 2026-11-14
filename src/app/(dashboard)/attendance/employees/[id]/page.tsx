import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { uuidParam } from "@/server/http/params";
import { getEmployeeAttendance } from "@/server/services/attendance-hr";
import { EmployeeAttendanceView } from "@/components/attendance/employee-attendance-view";

export const metadata: Metadata = { title: "Employee attendance" };

export default async function EmployeeAttendancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { actor, ctx } = await requirePageActor();
  const { id } = await params;
  const sp = await searchParams;
  const a = await getEmployeeAttendance(db, actor, uuidParam(id), sp.month, ctx);
  return <EmployeeAttendanceView a={a} base={`/attendance/employees/${a.employee.id}`} showNav={can(actor, "attendance:read")} canPolicy={can(actor, "policy:manage")} profileLink={can(actor, "employee:read")} />;
}
