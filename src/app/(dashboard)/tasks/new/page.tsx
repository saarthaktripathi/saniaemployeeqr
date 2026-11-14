import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listDirectoryOptions } from "@/server/services/employees";
import { TaskForm } from "@/components/tasks/task-form";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage() {
  const { actor, ctx } = await requirePageActor("task:manage");
  const options = await listDirectoryOptions(db, actor, ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Task Management" title="New Task" description="Each assignee gets their own copy to accept, work on and submit. You review and approve each submission." />
      <TaskForm mode="hr" departments={options.departments} doneHref="/tasks" />
    </div>
  );
}
