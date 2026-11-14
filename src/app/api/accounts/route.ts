import { authed, db, json } from "@/server/http/api";
import { listEmployeeAccounts } from "@/server/services/accounts";

export const GET = authed(async ({ req, actor, ctx }) => {
  return json(await listEmployeeAccounts(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx));
});
