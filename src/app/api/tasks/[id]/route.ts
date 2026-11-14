import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { getTaskDetail, updateTask } from "@/server/services/tasks";

type P = { id: string };

export const GET = authed<P>(async ({ actor, params }) => json(await getTaskDetail(db, actor, uuidParam(params.id, "Task"))));
export const PATCH = authed<P>(async ({ req, actor, ctx, params }) => json(await updateTask(db, actor, uuidParam(params.id, "Task"), await readJson(req), ctx)));
