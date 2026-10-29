import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { changeEmployeeStatus } from "@/server/services/employees";

export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  const employee = await changeEmployeeStatus(db, actor, uuidParam(params.id), await readJson(req), ctx);
  return json({ employee });
});
