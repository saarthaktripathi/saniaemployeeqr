import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { reviewCorrection } from "@/server/services/attendance-corrections";

/** Body: { decision: "APPLY" | "REJECT", note? }. */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => json(await reviewCorrection(db, actor, uuidParam(params.id, "Correction"), await readJson(req), ctx)));
