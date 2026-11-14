import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { respondToLeaveClarification } from "@/server/services/leave";

export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  await respondToLeaveClarification(db, actor, uuidParam(params.id, "Leave request"), await readJson(req), ctx);
  return json({ ok: true });
});
