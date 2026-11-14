import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { listTasks } from "@/server/services/tasks";
import { TaskTable } from "@/components/tasks/task-table";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Team tasks" };

export default async function TeamTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requireWorkspaceActor();
  if (actor.role !== "TEAM_MANAGER") redirect("/me/tasks");
  const sp = await searchParams;
  const data = await listTasks(db, actor, sp, ctx);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="My team"
        title="Team Tasks"
        description="Tasks you assigned and work assigned to your team. Review submissions and track progress."
        actions={
          <ButtonLink href="/me/team/tasks/new">
            <Plus className="size-4" aria-hidden /> Assign a task
          </ButtonLink>
        }
      />
      <TaskTable data={data} basePath="/me/team/tasks" detailBase="/me/tasks/" params={sp} />
    </div>
  );
}
