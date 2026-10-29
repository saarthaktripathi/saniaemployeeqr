import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { getEmployee, updateEmployee } from "@/server/services/employees";

type P = { id: string };

export const GET = authed<P>(async ({ actor, ctx, params }) => {
  return json({ employee: await getEmployee(db, actor, uuidParam(params.id), ctx) });
});

export const PATCH = authed<P>(async ({ req, actor, ctx, params }) => {
  const employee = await updateEmployee(db, actor, uuidParam(params.id), await readJson(req), ctx);
  return json({ employee });
});
