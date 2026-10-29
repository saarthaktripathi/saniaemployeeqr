import { db } from "@/server/db/client";
import { logger } from "@/server/logging/logger";

// Readiness: the app can reach its database.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("readiness.failed", { err });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
