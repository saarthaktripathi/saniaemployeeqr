import { authed, db, json, readJson } from "@/server/http/api";
import { bulkChangeStatus } from "@/server/services/employees";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

export const POST = authed(async ({ req, actor, ctx }) => {
  await enforceRateLimit(db, "bulk", actor.id, RATE_RULES.bulk);
  return json(await bulkChangeStatus(db, actor, await readJson(req), ctx));
});
