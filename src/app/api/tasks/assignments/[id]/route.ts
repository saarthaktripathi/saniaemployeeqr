import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { actOnAssignment } from "@/server/services/tasks";

/** Assignee: { action: ACCEPT | START | PROGRESS | SUBMIT, progress?, note? }. */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await actOnAssignment(db, actor, uuidParam(params.id, "Task"), await readJson(req), ctx)));
