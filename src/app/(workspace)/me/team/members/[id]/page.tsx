import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { uuidParam } from "@/server/http/params";
import { getEmployeeAttendance } from "@/server/services/attendance-hr";
import { EmployeeAttendanceView } from "@/components/attendance/employee-attendance-view";

export const metadata: Metadata = { title: "Team member attendance" };

export default async function TeamMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { actor, ctx } = await requireWorkspaceActor();
  if (actor.role !== "TEAM_MANAGER") redirect("/me");
  const { id } = await params;
  const sp = await searchParams;
  const a = await getEmployeeAttendance(db, actor, uuidParam(id), sp.month, ctx);
  return <EmployeeAttendanceView a={a} base={`/me/team/members/${a.employee.id}`} showNav={false} canPolicy={false} profileLink={false} />;
}
