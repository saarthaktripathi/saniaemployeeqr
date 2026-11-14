import { authed, db, json } from "@/server/http/api";
import { listLeaveRequests } from "@/server/services/leave";

export const GET = authed(async ({ req, actor, ctx }) => json(await listLeaveRequests(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx)));
