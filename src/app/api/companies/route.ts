import { authed, db, json, readJson } from "@/server/http/api";
import { createCompany, listCompanies } from "@/server/services/companies";

export const GET = authed(async ({ actor, ctx }) => json({ companies: await listCompanies(db, actor, ctx) }));

export const POST = authed(async ({ req, actor, ctx }) => {
  return json({ company: await createCompany(db, actor, await readJson(req), ctx) }, { status: 201 });
});
