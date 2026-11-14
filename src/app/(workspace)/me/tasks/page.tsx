import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyTasks } from "@/server/services/tasks";
import { TASK_VIEWS, type TaskView } from "@/features/tasks/schema";
import { TaskBoard } from "@/components/tasks/task-board";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { actor } = await requireWorkspaceActor();
  const sp = await searchParams;
  const view = (TASK_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as TaskView) : "all";
  const data = await getMyTasks(db, actor, "all");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Employee workspace" title="My Tasks" description="Everything assigned to you. Open a task to read the instructions, update progress, upload your work and submit it for review." />
      <TaskBoard items={data.items} today={data.today} initialView={view} hrefBase="/me/tasks/" />
    </div>
  );
}
