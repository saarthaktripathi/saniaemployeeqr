import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { addHistoryEntry, listHistory } from "@/server/services/history";

type P = { id: string };

export const GET = authed<P>(async ({ actor, ctx, params }) => json({ history: await listHistory(db, actor, uuidParam(params.id), ctx) }));

export const POST = authed<P>(async ({ req, actor, ctx, params }) => {
  return json({ entry: await addHistoryEntry(db, actor, uuidParam(params.id), await readJson(req), ctx) }, { status: 201 });
});
