import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { revokeInvitation } from "@/server/services/accounts";

export const DELETE = authed<{ id: string }>(async ({ actor, ctx, params }) => {
  await revokeInvitation(db, actor, uuidParam(params.id, "Invitation"), ctx);
  return json({ ok: true });
});
