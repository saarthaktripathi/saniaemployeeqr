import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { deleteCompany, updateCompany } from "@/server/services/companies";

type P = { id: string };

export const PATCH = authed<P>(async ({ req, actor, ctx, params }) => {
  return json({ company: await updateCompany(db, actor, uuidParam(params.id, "Company"), await readJson(req), ctx) });
});

export const DELETE = authed<P>(async ({ actor, ctx, params }) => json(await deleteCompany(db, actor, uuidParam(params.id, "Company"), ctx)));
