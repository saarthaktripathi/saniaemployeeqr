import { authed, db, json, readJson } from "@/server/http/api";
import { updateAttendancePolicy } from "@/server/services/attendance-policy";

export const PATCH = authed(async ({ req, actor, ctx }) => json({ policy: await updateAttendancePolicy(db, actor, await readJson(req), ctx) }));
