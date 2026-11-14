import { authed, db } from "@/server/http/api";
import { toCsv } from "@/lib/csv";
import { toXlsx, XLSX_TYPE } from "@/lib/xlsx-writer";
import { buildAttendanceExport } from "@/server/services/attendance-export";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";

/** ?kind=daily|history|monthly&format=csv|xlsx plus the page's filters. */
export const GET = authed(async ({ req, actor, ctx }) => {
  await enforceRateLimit(db, "export", actor.id, RATE_RULES.export);
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const table = await buildAttendanceExport(db, actor, params, ctx);
  const xlsx = params.format === "xlsx";
  const body = xlsx ? new Uint8Array(toXlsx(table.title, table.header, table.rows)) : toCsv(table.header, table.rows.map((r) => r.map((c) => c ?? "")));
  return new Response(body, {
    headers: {
      "Content-Type": xlsx ? XLSX_TYPE : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sania-${table.filename}.${xlsx ? "xlsx" : "csv"}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
