import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { uuidParam } from "@/server/http/params";
import { getTaskDetail } from "@/server/services/tasks";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Task" };

export default async function MyTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireWorkspaceActor();
  const { id } = await params;
  const task = await getTaskDetail(db, actor, uuidParam(id, "Task"));
  return (
    <div className="mx-auto max-w-6xl">
      <Link href={actor.role === "TEAM_MANAGER" && !task.myAssignmentId ? "/me/team/tasks" : "/me/tasks"} className="mb-3 inline-block text-sm font-medium text-primary-600 hover:underline">
        ← Back to tasks
      </Link>
      <PageHeader eyebrow={task.code} title={task.title} plain />
      <TaskDetailView task={task} />
    </div>
  );
}
