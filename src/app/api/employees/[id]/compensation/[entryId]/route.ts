import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteCompensation } from "@/server/services/compensation";

export const DELETE = authed<{ id: string; entryId: string }>(async ({ actor, ctx, params }) => {
  return json(await deleteCompensation(db, actor, uuidParam(params.id), uuidParam(params.entryId, "Compensation entry"), ctx));
});
