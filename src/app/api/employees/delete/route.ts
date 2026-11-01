import { authed, db, json, readJson } from "@/server/http/api";
import { deleteEmployees } from "@/server/services/employees";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

/** Permanently deletes one or many employees: { ids: string[], reason: string }. */
export const POST = authed(async ({ req, actor, ctx }) => {
  await enforceRateLimit(db, "bulk", actor.id, RATE_RULES.bulk);
  return json(await deleteEmployees(db, actor, await readJson(req), ctx));
});
