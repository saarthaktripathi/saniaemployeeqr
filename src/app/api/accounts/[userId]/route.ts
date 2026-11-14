import { authed, db, json, readJson } from "@/server/http/api";
import { updateEmployeeAccount } from "@/server/services/accounts";

/** Activate/deactivate an employee login or switch it between Employee and Team Manager. */
export const PATCH = authed<{ userId: string }>(async ({ req, actor, ctx, params }) => {
  return json({ user: await updateEmployeeAccount(db, actor, params.userId.slice(0, 64), await readJson(req), ctx) });
});
