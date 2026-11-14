import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { decideLeave } from "@/server/services/leave";

/** HR: { decision: APPROVE | REJECT | CLARIFY, note? }. */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await decideLeave(db, actor, uuidParam(params.id, "Leave request"), await readJson(req), ctx)));
