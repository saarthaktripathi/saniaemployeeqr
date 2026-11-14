import { db, json, publicRoute, readJson } from "@/server/http/api";
import { acceptInvitation } from "@/server/services/accounts";

/** Public: accept an invitation by choosing a password. Rate limited per client. */
export const POST = publicRoute<{ token: string }>(async ({ req, ctx, params }) => {
  return json({ account: await acceptInvitation(db, params.token, await readJson(req), ctx) }, { status: 201 });
});
