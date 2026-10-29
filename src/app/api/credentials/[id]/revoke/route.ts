import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { revokeCredential } from "@/server/services/credentials";

export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  const result = await revokeCredential(db, actor, uuidParam(params.id, "Credential"), await readJson(req), ctx);
  return json(result);
});
