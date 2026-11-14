import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { cancelLeave } from "@/server/services/leave";

export const DELETE = authed<{ id: string }>(async ({ actor, ctx, params }) => {
  await cancelLeave(db, actor, uuidParam(params.id, "Leave request"), ctx);
  return json({ ok: true });
});
