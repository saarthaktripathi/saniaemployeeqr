import { authed, db } from "@/server/http/api";
import { exportEmployeesCsv } from "@/server/services/employees";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

export const GET = authed(async ({ req, actor, ctx }) => {
  await enforceRateLimit(db, "export", actor.id, RATE_RULES.export);
  const csv = await exportEmployeesCsv(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sania-employees-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
