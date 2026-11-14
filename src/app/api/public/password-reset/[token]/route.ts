import { db, json, publicRoute, readJson } from "@/server/http/api";
import { completePasswordReset } from "@/server/services/accounts";

/** Public: set a new password from a single-use reset link. Rate limited per client. */
export const POST = publicRoute<{ token: string }>(async ({ req, ctx, params }) => {
  return json({ account: await completePasswordReset(db, params.token, await readJson(req), ctx) });
});
