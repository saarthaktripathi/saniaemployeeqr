import { authed, db, json, readJson } from "@/server/http/api";
import { addHoliday } from "@/server/services/attendance-policy";

export const POST = authed(async ({ req, actor, ctx }) => json({ holiday: await addHoliday(db, actor, await readJson(req), ctx) }, { status: 201 }));
