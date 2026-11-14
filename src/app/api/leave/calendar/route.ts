import { authed, db, json } from "@/server/http/api";
import { getLeaveCalendar } from "@/server/services/leave";

export const GET = authed(async ({ req, actor, ctx }) => json(await getLeaveCalendar(db, actor, req.nextUrl.searchParams.get("month") ?? undefined, ctx)));
