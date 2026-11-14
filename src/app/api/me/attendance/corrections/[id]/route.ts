import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { cancelCorrection } from "@/server/services/attendance-corrections";

export const DELETE = authed<{ id: string }>(async ({ actor, ctx, params }) => {
  await cancelCorrection(db, actor, uuidParam(params.id, "Correction"), ctx);
  return json({ ok: true });
});
