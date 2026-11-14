import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { eachDate } from "@/lib/time";

/** Approved leave covering a date: `${employeeId}|${date}` -> half-day flag. */
export type LeaveDayMap = Map<string, { half: boolean }>;

/**
 * Approved leave for employees over a date range, expanded to individual dates. Attendance uses it
 * so approved leave is never counted as absence (weekly offs and holidays keep their own status).
 */
export async function approvedLeaveDays(db: Db | Tx, employeeIds: string[], from: string, to: string): Promise<LeaveDayMap> {
  const map: LeaveDayMap = new Map();
  if (employeeIds.length === 0) return map;
  const rows = await db.leaveRequest.findMany({
    where: { employeeId: { in: employeeIds }, status: "APPROVED", startDate: { lte: new Date(`${to}T00:00:00Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } },
    select: { employeeId: true, startDate: true, endDate: true, halfDay: true },
  });
  for (const r of rows) {
    const s = r.startDate.toISOString().slice(0, 10);
    const e = r.endDate.toISOString().slice(0, 10);
    for (const date of eachDate(s < from ? from : s, e > to ? to : e)) map.set(`${r.employeeId}|${date}`, { half: r.halfDay !== "NONE" });
  }
  return map;
}
