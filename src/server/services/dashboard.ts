import "server-only";
import type { Db } from "@/server/db/client";
import { addDays, utcToday } from "@/features/employees/rules";
import type { Actor, RequestContext } from "./context";
import { authorize } from "./employees";
import { getSettings } from "./settings";

/**
 * Metric definitions (all exclude archived records unless stated):
 * - totalRecords: non-archived employees
 * - active / inactive: non-archived employees by employment status
 * - archived: archived employees
 * - expiredIds: non-archived employees whose ID expiry date is before today (UTC)
 * - expiringSoon: non-archived, ID expires between today and today + warning window
 * - validCredentials: non-revoked, unexpired credentials of non-archived employees
 * - verifications7d: public verification checks in the last 7 days, by result
 */
export interface DashboardStats {
  totalRecords: number;
  active: number;
  inactive: number;
  archived: number;
  expiredIds: number;
  expiringSoon: number;
  validCredentials: number;
  warnDays: number;
  verifications7d: { result: string; count: number }[];
  departments: { department: string; count: number }[];
}

export async function getDashboardStats(db: Db, actor: Actor, ctx: RequestContext, now = new Date()): Promise<DashboardStats> {
  await authorize(db, actor, "dashboard:read", ctx);
  const settings = await getSettings(db);
  const today = utcToday(now);
  const warnUntil = addDays(today, settings.expiryWarningDays);
  const since = addDays(now, -7);

  const [counts, creds, verifications, departments] = await Promise.all([
    db.$queryRaw<Record<string, bigint>[]>`
      SELECT
        count(*) FILTER (WHERE "archivedAt" IS NULL) AS total,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "employmentStatus" = 'ACTIVE') AS active,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "employmentStatus" = 'INACTIVE') AS inactive,
        count(*) FILTER (WHERE "archivedAt" IS NOT NULL) AS archived,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "idExpiresAt" < ${today}::date) AS expired,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "idExpiresAt" >= ${today}::date AND "idExpiresAt" <= ${warnUntil}::date) AS expiring
      FROM "employee"`,
    db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "employee_credential" c
      JOIN "employee" e ON e."id" = c."employeeId"
      WHERE c."revokedAt" IS NULL AND c."expiresAt" > ${now} AND e."archivedAt" IS NULL`,
    db.verificationEvent.groupBy({
      by: ["result"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.employee.groupBy({
      by: ["department"],
      where: { archivedAt: null },
      _count: { _all: true },
      orderBy: { _count: { department: "desc" } },
      take: 8,
    }),
  ]);

  const c = counts[0] ?? {};
  const n = (v: bigint | undefined) => Number(v ?? 0);
  return {
    totalRecords: n(c.total),
    active: n(c.active),
    inactive: n(c.inactive),
    archived: n(c.archived),
    expiredIds: n(c.expired),
    expiringSoon: n(c.expiring),
    validCredentials: n(creds[0]?.n),
    warnDays: settings.expiryWarningDays,
    verifications7d: verifications.map((v) => ({ result: v.result, count: v._count._all })),
    departments: departments.map((d) => ({ department: d.department, count: d._count._all })),
  };
}
