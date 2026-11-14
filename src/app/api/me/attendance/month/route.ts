import { authed, db, json } from "@/server/http/api";
import { getMyAttendanceMonth } from "@/server/services/attendance";

export const GET = authed(async ({ req, actor }) => json(await getMyAttendanceMonth(db, actor, req.nextUrl.searchParams.get("month") ?? undefined)));
