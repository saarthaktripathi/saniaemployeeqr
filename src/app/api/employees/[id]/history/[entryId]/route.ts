import { authed, db, json } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteHistoryEntry } from "@/server/services/history";

export const DELETE = authed<{ id: string; entryId: string }>(async ({ actor, ctx, params }) => {
  return json(await deleteHistoryEntry(db, actor, uuidParam(params.id), uuidParam(params.entryId, "History entry"), ctx));
});
