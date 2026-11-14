import { authed, db, json } from "@/server/http/api";
import { TASK_VIEWS, type TaskView } from "@/features/tasks/schema";
import { getMyTasks } from "@/server/services/tasks";

export const GET = authed(async ({ req, actor }) => {
  const v = req.nextUrl.searchParams.get("view") ?? "all";
  return json(await getMyTasks(db, actor, (TASK_VIEWS as readonly string[]).includes(v) ? (v as TaskView) : "all"));
});
