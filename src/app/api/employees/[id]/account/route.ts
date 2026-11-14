import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { getEmployeeAccount } from "@/server/services/accounts";

export const GET = authed<{ id: string }>(async ({ actor, ctx, params }) => {
  return json(await getEmployeeAccount(db, actor, uuidParam(params.id), ctx));
});
