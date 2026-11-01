import "server-only";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";

export interface RateRule {
  /** Window length in seconds. */
  window: number;
  max: number;
}

export const RATE_RULES = {
  verify: { window: 60, max: 30 },
  employeeCreate: { window: 60, max: 30 },
  credentialIssue: { window: 60, max: 30 },
  bulk: { window: 60, max: 5 },
  photoUpload: { window: 60, max: 30 },
  export: { window: 300, max: 10 },
} satisfies Record<string, RateRule>;

/**
 * Atomic fixed-window counter in PostgreSQL (shared by all app instances).
 * Returns the remaining allowance; throws RATE_LIMITED when exceeded.
 */
export async function enforceRateLimit(db: Db, bucket: string, subject: string, rule: RateRule): Promise<number> {
  const now = Date.now();
  const windowStart = BigInt(now - (now % (rule.window * 1000)));
  const key = `${bucket}:${subject}`;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "app_rate_limit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "app_rate_limit"."windowStart" = EXCLUDED."windowStart" THEN "app_rate_limit"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > rule.max) {
    const retryAfter = Math.ceil((Number(windowStart) + rule.window * 1000 - now) / 1000);
    throw new AppError("RATE_LIMITED", "Too many requests. Please try again shortly.", { retryAfter });
  }
  return rule.max - count;
}
