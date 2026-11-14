import { authed, db, json, readJson } from "@/server/http/api";
import { applyLeave, getMyLeave } from "@/server/services/leave";

export const GET = authed(async ({ req, actor }) => json(await getMyLeave(db, actor, req.nextUrl.searchParams.get("year") ?? undefined)));

/** Body: { leaveTypeId, startDate, endDate, halfDay?, reason }. */
export const POST = authed(async ({ req, actor, ctx }) => json({ leave: await applyLeave(db, actor, await readJson(req), ctx) }, { status: 201 }));
