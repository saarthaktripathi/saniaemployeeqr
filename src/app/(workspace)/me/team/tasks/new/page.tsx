import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { withRls } from "@/server/db/rls";
import { teamMemberIds } from "@/server/services/team";
import { TaskForm } from "@/components/tasks/task-form";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Assign a task" };

export default async function NewTeamTaskPage() {
  const { actor } = await requireWorkspaceActor();
  if (actor.role !== "TEAM_MANAGER") redirect("/me/tasks");
  const ids = await teamMemberIds(db, actor.employeeId);
  const team = await withRls(db, actor, (tx) =>
    tx.employee.findMany({ where: { id: { in: ids }, employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, employeeCode: true, jobTitle: true, department: true } }),
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="My team" title="Assign a Task" description="Only people who report to you (directly or through their managers) can be assigned." />
      <TaskForm mode="team" team={team} doneHref="/me/tasks" />
    </div>
  );
}
