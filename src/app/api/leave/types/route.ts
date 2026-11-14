import { authed, db, json, readJson } from "@/server/http/api";
import { createLeaveType } from "@/server/services/leave";

export const POST = authed(async ({ req, actor, ctx }) => json({ leaveType: await createLeaveType(db, actor, await readJson(req), ctx) }, { status: 201 }));
