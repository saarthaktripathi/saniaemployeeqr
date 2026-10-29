import { authed, db, json, readJson } from "@/server/http/api";
import { createEmployee, listEmployees } from "@/server/services/employees";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

export const GET = authed(async ({ req, actor, ctx }) => {
  const result = await listEmployees(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx);
  return json(result);
});

export const POST = authed(async ({ req, actor, ctx }) => {
  await enforceRateLimit(db, "employee-create", actor.id, RATE_RULES.employeeCreate);
  const employee = await createEmployee(db, actor, await readJson(req), ctx);
  return json({ employee }, { status: 201 });
});
