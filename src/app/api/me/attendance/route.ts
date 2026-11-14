import { authed, db, json } from "@/server/http/api";
import { getMyAttendanceToday } from "@/server/services/attendance";

/** Today's attendance for the signed-in employee (card state, policy, sessions). */
export const GET = authed(async ({ actor }) => json(await getMyAttendanceToday(db, actor)));
