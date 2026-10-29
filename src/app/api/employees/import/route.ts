import { AppError } from "@/lib/errors";
import { authed, db, json, readText } from "@/server/http/api";
import { importEmployeesCsv } from "@/server/services/employees";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

export const POST = authed(async ({ req, actor, ctx }) => {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("text/csv")) throw new AppError("VALIDATION", "Upload a CSV file (text/csv)");
  await enforceRateLimit(db, "bulk", actor.id, RATE_RULES.bulk);
  return json(await importEmployeesCsv(db, actor, await readText(req), ctx), { status: 201 });
});
