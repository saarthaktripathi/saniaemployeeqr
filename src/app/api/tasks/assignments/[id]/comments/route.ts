import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { addTaskComment } from "@/server/services/tasks";

export const POST = authed<{ id: string }>(async ({ req, actor, params }) => json(await addTaskComment(db, actor, uuidParam(params.id, "Task"), await readJson(req)), { status: 201 }));
