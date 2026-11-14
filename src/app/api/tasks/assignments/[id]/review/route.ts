import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { reviewAssignment } from "@/server/services/tasks";

/** Creator or HR: { decision: APPROVE | REJECT, note? }. */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await reviewAssignment(db, actor, uuidParam(params.id, "Task"), await readJson(req), ctx)));
