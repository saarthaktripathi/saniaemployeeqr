import { authed, db, json, readJson } from "@/server/http/api";
import { punchOut } from "@/server/services/attendance";

/** Body: { notes? }. Closes the open session with a server timestamp. */
export const POST = authed(async ({ req, actor, ctx }) => json({ session: await punchOut(db, actor, await readJson(req), ctx) }));
