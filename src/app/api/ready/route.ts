import { db } from "@/server/db/client";
import { RLS_ROLE } from "@/server/db/rls";
import { logger } from "@/server/logging/logger";

const noStore = { "Cache-Control": "no-store" };

// Readiness: the app can reach its database and can switch to the row-level-security role that
// workforce requests run under (attendance, tasks, leave and notifications fail without it).
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error("readiness.failed", { err });
    return Response.json({ status: "unavailable" }, { status: 503, headers: noStore });
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      await tx.$queryRaw`SELECT 1`;
    });
  } catch (err) {
    logger.error("readiness.rls_failed", { err });
    return Response.json({ status: "degraded", rowSecurity: "unavailable" }, { status: 503, headers: noStore });
  }
  return Response.json({ status: "ready" }, { headers: noStore });
}
