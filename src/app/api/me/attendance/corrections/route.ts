import { authed, db, json, readJson } from "@/server/http/api";
import { requestCorrection } from "@/server/services/attendance-corrections";

/** Employee requests a correction of their own attendance (reviewed by HR). */
export const POST = authed(async ({ req, actor, ctx }) => json({ correction: await requestCorrection(db, actor, await readJson(req), ctx) }, { status: 201 }));
