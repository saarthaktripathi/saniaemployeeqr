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
 * - newLast30d: non-archived employees created in the last 30 days
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
  newLast30d: number;
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
  const since30 = addDays(now, -30);

  const [counts, creds, verifications, departments] = await Promise.all([
    db.$queryRaw<Record<string, bigint>[]>`
      SELECT
        count(*) FILTER (WHERE "archivedAt" IS NULL) AS total,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "employmentStatus" = 'ACTIVE') AS active,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "employmentStatus" = 'INACTIVE') AS inactive,
        count(*) FILTER (WHERE "archivedAt" IS NOT NULL) AS archived,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "idExpiresAt" < ${today}::date) AS expired,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "idExpiresAt" >= ${today}::date AND "idExpiresAt" <= ${warnUntil}::date) AS expiring,
        count(*) FILTER (WHERE "archivedAt" IS NULL AND "createdAt" >= ${since30}) AS recent
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
    newLast30d: n(c.recent),
    warnDays: settings.expiryWarningDays,
    verifications7d: verifications.map((v) => ({ result: v.result, count: v._count._all })),
    departments: departments.map((d) => ({ department: d.department, count: d._count._all })),
  };
}

// ---------------------------------------------------------------------------
// KPI history (sparklines and week-over-week trend)
// ---------------------------------------------------------------------------

export const TREND_POINTS = 8; // weekly points, oldest first; the last point is "now"
const TREND_TTL_MS = 5 * 60_000;

export type TrendKey = "total" | "active" | "inactive" | "qr" | "expired" | "expiring";
export type DashboardTrends = Record<TrendKey, number[]>;

let trendCache: { key: string; at: number; value: DashboardTrends } | null = null;

/**
 * Reconstructs each KPI at weekly points over the last 7 weeks from real data:
 * - totals/expiry from employee created/archived timestamps and ID dates
 * - QR credentials from issue/revoke/expiry timestamps
 * - active/inactive from the audited status transitions (metadata.from / .to)
 * Records deleted since are not in the history. The newest point is replaced by the
 * live figures by the caller, so the big number and the sparkline always agree.
 * Cached per process for 5 minutes: history changes slowly and the query scans per week.
 */
export async function getDashboardTrends(db: Db, actor: Actor, ctx: RequestContext, now = new Date()): Promise<DashboardTrends> {
  await authorize(db, actor, "dashboard:read", ctx);
  const settings = await getSettings(db);
  const key = `${settings.expiryWarningDays}`;
  if (trendCache && trendCache.key === key && Date.now() - trendCache.at < TREND_TTL_MS) return trendCache.value;

  const rows = await db.$queryRaw<{ i: number; total: bigint; active: bigint; qr: bigint; expired: bigint; expiring: bigint }[]>`
    WITH t AS (
      SELECT i, (${now}::timestamptz - ((${TREND_POINTS - 1} - i) * interval '7 days')) AS ts
      FROM generate_series(0, ${TREND_POINTS - 1}) AS i
    ),
    alive AS (
      SELECT t.i, t.ts, e."id", e."idExpiresAt", e."employmentStatus"
      FROM t JOIN "employee" e ON e."createdAt" <= t.ts AND (e."archivedAt" IS NULL OR e."archivedAt" > t.ts)
    ),
    status_at AS (
      SELECT a.i,
        coalesce(
          (SELECT l."metadata"->>'to' FROM "audit_log" l
            WHERE l."targetType" = 'employee' AND l."targetId" = a."id"::text AND l."createdAt" <= a.ts
              AND l."action" IN ('employee.deactivated', 'employee.reactivated', 'employee.archived', 'employee.unarchived')
            ORDER BY l."createdAt" DESC, l."id" DESC LIMIT 1),
          (SELECT l."metadata"->>'from' FROM "audit_log" l
            WHERE l."targetType" = 'employee' AND l."targetId" = a."id"::text AND l."createdAt" > a.ts
              AND l."action" IN ('employee.deactivated', 'employee.reactivated', 'employee.archived', 'employee.unarchived')
            ORDER BY l."createdAt" ASC, l."id" ASC LIMIT 1),
          a."employmentStatus"::text
        ) AS status
      FROM alive a
    )
    SELECT t.i::int AS i,
      (SELECT count(*) FROM alive a WHERE a.i = t.i) AS total,
      (SELECT count(*) FROM status_at s WHERE s.i = t.i AND s.status = 'ACTIVE') AS active,
      (SELECT count(*) FROM alive a WHERE a.i = t.i AND a."idExpiresAt" < t.ts::date) AS expired,
      (SELECT count(*) FROM alive a WHERE a.i = t.i AND a."idExpiresAt" >= t.ts::date AND a."idExpiresAt" <= t.ts::date + ${settings.expiryWarningDays}::int) AS expiring,
      (SELECT count(*) FROM "employee_credential" c JOIN alive a ON a."id" = c."employeeId" AND a.i = t.i
        WHERE c."issuedAt" <= t.ts AND (c."revokedAt" IS NULL OR c."revokedAt" > t.ts) AND c."expiresAt" > t.ts) AS qr
    FROM t ORDER BY t.i`;

  const n = (v: bigint) => Number(v);
  const value: DashboardTrends = {
    total: rows.map((r) => n(r.total)),
    active: rows.map((r) => n(r.active)),
    inactive: rows.map((r) => n(r.total) - n(r.active)),
    qr: rows.map((r) => n(r.qr)),
    expired: rows.map((r) => n(r.expired)),
    expiring: rows.map((r) => n(r.expiring)),
  };
  trendCache = { key, at: Date.now(), value };
  return value;
}

/** Overwrites the newest point with live values so the chart ends at the displayed number. */
export function withLivePoint(trends: DashboardTrends, s: Pick<DashboardStats, "totalRecords" | "active" | "inactive" | "validCredentials" | "expiredIds" | "expiringSoon">): DashboardTrends {
  const live: Record<TrendKey, number> = { total: s.totalRecords, active: s.active, inactive: s.inactive, qr: s.validCredentials, expired: s.expiredIds, expiring: s.expiringSoon };
  return Object.fromEntries((Object.keys(live) as TrendKey[]).map((k) => [k, [...trends[k].slice(0, -1), live[k]]])) as DashboardTrends;
}

/** Test hook: clears the per-process trend cache. */
export function resetTrendCache() {
  trendCache = null;
}
