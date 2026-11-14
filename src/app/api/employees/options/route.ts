import { authed, db, json } from "@/server/http/api";
import { searchEmployeeOptions } from "@/server/services/employees";

/** Type-ahead for pickers: ?q=<name or ID>&exclude=<employee id>. */
export const GET = authed(async ({ req, actor, ctx }) => {
  return json({ options: await searchEmployeeOptions(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx) });
});
