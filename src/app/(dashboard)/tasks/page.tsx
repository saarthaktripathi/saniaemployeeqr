import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { listTasks } from "@/server/services/tasks";
import { TaskTable } from "@/components/tasks/task-table";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Task Management" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("task:read");
  const sp = await searchParams;
  const data = await listTasks(db, actor, sp, ctx);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Workforce"
        title="Task Management"
        description="Assign work to people or whole departments, follow progress and review submissions."
        actions={
          can(actor, "task:manage") ? (
            <ButtonLink href="/tasks/new">
              <Plus className="size-4" aria-hidden /> New task
            </ButtonLink>
          ) : undefined
        }
      />
      <TaskTable data={data} basePath="/tasks" detailBase="/tasks/" params={sp} />
    </div>
  );
}
