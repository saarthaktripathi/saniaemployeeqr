import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { updateLeaveType } from "@/server/services/leave";

export const PATCH = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await updateLeaveType(db, actor, uuidParam(params.id, "Leave type"), await readJson(req), ctx)));
