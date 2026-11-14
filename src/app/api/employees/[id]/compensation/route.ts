import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { addCompensation, listCompensation } from "@/server/services/compensation";

type P = { id: string };

/** Restricted (compensation:read). Each read is audited. */
export const GET = authed<P>(async ({ actor, ctx, params }) => json(await listCompensation(db, actor, uuidParam(params.id), ctx)));

export const POST = authed<P>(async ({ req, actor, ctx, params }) => {
  return json({ entry: await addCompensation(db, actor, uuidParam(params.id), await readJson(req), ctx) }, { status: 201 });
});
