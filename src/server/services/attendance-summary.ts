import "server-only";
import type { AttendancePolicy } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { summarizeDay, type DaySummary } from "@/features/attendance/rules";
import { eachDate } from "@/lib/time";
import { holidayLookup, listHolidays, policyRules } from "./attendance-policy";
import { approvedLeaveDays } from "./leave-days";

export interface SessionRow {
  id: string;
  employeeId: string;
  workDate: string;
  punchInAt: Date;
  punchOutAt: Date | null;
  location: "OFFICE" | "WORK_FROM_HOME" | "CLIENT_VISIT";
  status: "OPEN" | "CLOSED" | "CORRECTED" | "VOIDED";
  durationSeconds: number | null;
  needsReview: boolean;
  notes: string | null;
}

export const sessionSelect = {
  id: true,
  employeeId: true,
  workDate: true,
  punchInAt: true,
  punchOutAt: true,
  location: true,
  status: true,
  durationSeconds: true,
  needsReview: true,
  notes: true,
} as const;

type RawSession = Omit<SessionRow, "workDate"> & { workDate: Date };
export const toSessionRow = (s: RawSession): SessionRow => ({ ...s, workDate: s.workDate.toISOString().slice(0, 10) });

export interface EmployeeRef {
  id: string;
  companyId: string;
  joiningDate: Date | null;
}

export interface EmployeeDays {
  days: DaySummary[];
  sessions: SessionRow[];
}

/**
 * Day summaries for a set of employees over a date range: sessions, approved leave, company and
 * group holidays, and the policy. One query per data source (no N+1). Runs on any client, so it
 * honours RLS when called inside withRls.
 */
export async function summarizeRange(db: Db | Tx, policy: AttendancePolicy, employees: EmployeeRef[], from: string, to: string, now = new Date()): Promise<Map<string, EmployeeDays>> {
  const ids = employees.map((e) => e.id);
  const out = new Map<string, EmployeeDays>();
  if (ids.length === 0) return out;
  const [sessions, holidays, leave] = await Promise.all([
    db.attendanceSession.findMany({
      where: { employeeId: { in: ids }, workDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      orderBy: { punchInAt: "asc" },
      select: sessionSelect,
    }),
    listHolidays(db, from, to),
    approvedLeaveDays(db, ids, from, to),
  ]);
  const rules = policyRules(policy);
  const holidayFor = holidayLookup(holidays);
  const byEmployeeDate = new Map<string, SessionRow[]>();
  for (const raw of sessions) {
    const s = toSessionRow(raw);
    const key = `${s.employeeId}|${s.workDate}`;
    const list = byEmployeeDate.get(key);
    if (list) list.push(s);
    else byEmployeeDate.set(key, [s]);
  }
  const dates = eachDate(from, to);
  for (const e of employees) {
    const joining = e.joiningDate?.toISOString().slice(0, 10) ?? null;
    const days = dates.map((date) =>
      summarizeDay({
        date,
        sessions: byEmployeeDate.get(`${e.id}|${date}`) ?? [],
        holiday: holidayFor(date, e.companyId),
        leave: leave.get(`${e.id}|${date}`) ?? null,
        joiningDate: joining,
        policy: rules,
        now,
      }),
    );
    out.set(e.id, { days, sessions: dates.flatMap((d) => byEmployeeDate.get(`${e.id}|${d}`) ?? []) });
  }
  return out;
}

/** JSON-safe day summary for the client. */
export function serializeDay(d: DaySummary) {
  return { ...d, firstIn: d.firstIn?.toISOString() ?? null, lastOut: d.lastOut?.toISOString() ?? null };
}
export type DayView = ReturnType<typeof serializeDay>;

export function serializeSession(s: SessionRow) {
  return { ...s, punchInAt: s.punchInAt.toISOString(), punchOutAt: s.punchOutAt?.toISOString() ?? null };
}
export type SessionView = ReturnType<typeof serializeSession>;
