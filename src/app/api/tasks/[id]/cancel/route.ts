import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { cancelTask } from "@/server/services/tasks";

export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await cancelTask(db, actor, uuidParam(params.id, "Task"), await readJson(req), ctx)));
