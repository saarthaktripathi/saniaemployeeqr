import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteHoliday } from "@/server/services/attendance-policy";

export const DELETE = authed<{ id: string }>(async ({ actor, ctx, params }) => {
  await deleteHoliday(db, actor, uuidParam(params.id, "Holiday"), ctx);
  return json({ ok: true });
});
