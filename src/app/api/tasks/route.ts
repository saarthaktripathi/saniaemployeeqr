import { authed, db, json, readJson } from "@/server/http/api";
import { createTask, listTasks } from "@/server/services/tasks";

export const GET = authed(async ({ req, actor, ctx }) => json(await listTasks(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx)));

/** Creates a task for one person, several people or a whole department (HR), or for team members (managers). */
export const POST = authed(async ({ req, actor, ctx }) => json({ task: await createTask(db, actor, await readJson(req), ctx) }, { status: 201 }));
