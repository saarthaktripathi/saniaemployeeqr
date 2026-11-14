import "server-only";
import type { AttendancePolicy, Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { addDays, daysInclusive, localDate, monthBounds } from "@/lib/time";
import { historyQuerySchema, monthSchema, overviewQuerySchema, type AttendanceTab } from "@/features/attendance/schema";
import { DAY_STATUS_LABELS, isStale, periodStats, type DaySummary } from "@/features/attendance/rules";
import { can } from "@/server/authorization/permissions";
import type { Actor, RequestContext } from "./context";
import { authorize } from "./authorize";
import { getAttendancePolicy } from "./attendance-policy";
import { serializeDay, serializeSession, summarizeRange, type SessionRow } from "./attendance-summary";
import { managesEmployee, teamMemberIds } from "./team";

const PAGE = 25;

/**
 * Who the caller may see: everyone (attendance:read) or, for team managers, their reporting tree.
 * Denials are audited. RLS applies the same rule in the database.
 */
async function attendanceScope(db: Db, actor: Actor, ctx: RequestContext): Promise<{ all: true } | { all: false; ids: string[] }> {
  if (can(actor, "attendance:read")) return { all: true };
  if (actor.role === "TEAM_MANAGER" && actor.employeeId) return { all: false, ids: await teamMemberIds(db, actor.employeeId) };
  await authorize(db, actor, "attendance:read", ctx, { type: "attendance" });
  throw forbidden();
}

interface RosterFilter {
  q?: string;
  department?: string;
  company?: string;
  ids?: string[];
}

/** Attendance roster: active, non-archived employees who have an active login (they can punch). */
function rosterWhere(f: RosterFilter): Prisma.EmployeeWhereInput {
  return {
    archivedAt: null,
    employmentStatus: "ACTIVE",
    user: { is: { isActive: true } },
    ...(f.ids ? { id: { in: f.ids } } : {}),
    ...(f.department ? { department: { equals: f.department, mode: "insensitive" } } : {}),
    ...(f.company ? { companyId: f.company } : {}),
    ...(f.q
      ? {
          OR: [
            { displayName: { contains: f.q, mode: "insensitive" } },
            { employeeCode: { startsWith: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

const rosterSelect = {
  id: true,
  employeeCode: true,
  displayName: true,
  department: true,
  jobTitle: true,
  companyId: true,
  joiningDate: true,
  photoKey: true,
  photoUpdatedAt: true,
  company: { select: { name: true } },
} as const;

type RosterEmployee = Prisma.EmployeeGetPayload<{ select: typeof rosterSelect }>;

export interface AttendanceRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  company: string;
  photoUpdatedAt: string | null;
  status: DaySummary["status"];
  statusLabel: string;
  firstIn: string | null;
  lastOut: string | null;
  workedSeconds: number;
  location: SessionRow["location"] | null;
  late: boolean;
  lateMinutes: number;
  earlyLeave: boolean;
  earlyMinutes: number;
  open: boolean;
  incomplete: boolean;
  sessions: number;
}

function toRow(e: RosterEmployee, d: DaySummary, sessions: SessionRow[]): AttendanceRow {
  const live = sessions.filter((s) => s.status !== "VOIDED");
  return {
    employeeId: e.id,
    employeeCode: e.employeeCode,
    name: e.displayName,
    department: e.department,
    designation: e.jobTitle,
    company: e.company.name,
    photoUpdatedAt: e.photoKey ? (e.photoUpdatedAt?.toISOString() ?? null) : null,
    status: d.status,
    statusLabel: DAY_STATUS_LABELS[d.status],
    firstIn: d.firstIn?.toISOString() ?? null,
    lastOut: d.lastOut?.toISOString() ?? null,
    workedSeconds: d.workedSeconds,
    location: live[live.length - 1]?.location ?? null,
    late: d.late,
    lateMinutes: d.lateMinutes,
    earlyLeave: d.earlyLeave,
    earlyMinutes: d.earlyMinutes,
    open: d.open,
    incomplete: d.incomplete,
    sessions: live.length,
  };
}

const PRESENT_STATUSES = new Set(["PRESENT", "HALF_DAY", "SHORT", "WORKING"]);
const isPresent = (r: AttendanceRow) => PRESENT_STATUSES.has(r.status) || r.workedSeconds > 0 || r.open;
const isAbsent = (r: AttendanceRow) => (r.status === "ABSENT" || r.status === "NOT_STARTED") && !r.open;

function matchesTab(r: AttendanceRow, tab: AttendanceTab): boolean {
  switch (tab) {
    case "present":
      return isPresent(r);
    case "absent":
      return isAbsent(r);
    case "late":
      return r.late;
    case "leave":
      return r.status === "ON_LEAVE";
    case "incomplete":
      return r.incomplete;
    default:
      return true;
  }
}

const STATUS_ORDER: Record<string, number> = { WORKING: 0, PRESENT: 1, HALF_DAY: 2, SHORT: 3, NOT_STARTED: 4, ABSENT: 5, ON_LEAVE: 6, HOLIDAY: 7, WEEKLY_OFF: 8 };

function sortRows(rows: AttendanceRow[], sort: string | undefined, dir: "asc" | "desc" | undefined) {
  const m = dir === "desc" ? -1 : 1;
  const by: Record<string, (a: AttendanceRow, b: AttendanceRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    in: (a, b) => (a.firstIn ?? "9").localeCompare(b.firstIn ?? "9"),
    out: (a, b) => (a.lastOut ?? "9").localeCompare(b.lastOut ?? "9"),
    worked: (a, b) => a.workedSeconds - b.workedSeconds,
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name),
  };
  return rows.sort((a, b) => m * (by[sort ?? "status"] ?? by.status!)(a, b));
}

async function loadRoster(tx: Tx, f: RosterFilter) {
  return tx.employee.findMany({ where: rosterWhere(f), select: rosterSelect, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: 5000 });
}

export interface IncompleteSession {
  sessionId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  workDate: string;
  punchInAt: string;
  punchOutAt: string | null;
  location: string;
  reason: "MISSED_PUNCH_OUT" | "NEEDS_REVIEW";
}

/** Open sessions older than the policy limit, plus closed sessions flagged for review. */
async function incompleteSessions(tx: Tx, policy: AttendancePolicy, ids: string[] | null, now: Date): Promise<IncompleteSession[]> {
  const cutoff = new Date(now.getTime() - policy.maxSessionHours * 3_600_000);
  const rows = await tx.attendanceSession.findMany({
    where: {
      ...(ids ? { employeeId: { in: ids } } : {}),
      OR: [{ status: "OPEN", punchInAt: { lt: cutoff } }, { needsReview: true, status: { not: "VOIDED" } }],
    },
    orderBy: { punchInAt: "asc" },
    take: 200,
    select: { id: true, employeeId: true, workDate: true, punchInAt: true, punchOutAt: true, location: true, status: true, employee: { select: { employeeCode: true, displayName: true, department: true } } },
  });
  return rows.map((s) => ({
    sessionId: s.id,
    employeeId: s.employeeId,
    employeeCode: s.employee.employeeCode,
    name: s.employee.displayName,
    department: s.employee.department,
    workDate: s.workDate.toISOString().slice(0, 10),
    punchInAt: s.punchInAt.toISOString(),
    punchOutAt: s.punchOutAt?.toISOString() ?? null,
    location: s.location,
    reason: s.status === "OPEN" ? "MISSED_PUNCH_OUT" : "NEEDS_REVIEW",
  }));
}

/**
 * Daily attendance board: KPIs for the date, the rows for the selected tab (searched, sorted,
 * paginated), the incomplete-session queue and month-to-date attendance %.
 */
export async function getAttendanceOverview(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const scope = await attendanceScope(db, actor, ctx);
  const q = overviewQuerySchema.parse(raw ?? {});
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const today = localDate(now, policy.timezone);
  const date = q.date && q.date <= today ? q.date : today;
  const tab: AttendanceTab = q.tab ?? "live";
  const monthStart = `${date.slice(0, 7)}-01`;

  return withRls(db, actor, async (tx) => {
    const ids = scope.all ? undefined : scope.ids;
    const everyone = await loadRoster(tx, { ids });
    const filtered = await loadRoster(tx, { ids, q: q.q, department: q.department, company: q.company });
    const month = await summarizeRange(tx, policy, everyone, monthStart, date, now);
    const filteredIds = new Set(filtered.map((e) => e.id));

    const allRows = everyone.map((e) => {
      const m = month.get(e.id)!;
      const d = m.days[m.days.length - 1]!;
      return toRow(e, d, m.sessions.filter((s) => s.workDate === date));
    });
    const present = allRows.filter(isPresent);
    const kpis = {
      totalEmployees: allRows.length,
      present: present.length,
      absent: allRows.filter(isAbsent).length,
      working: allRows.filter((r) => r.open && !r.incomplete).length,
      onLeave: allRows.filter((r) => r.status === "ON_LEAVE").length,
      late: allRows.filter((r) => r.late).length,
      earlyDepartures: allRows.filter((r) => r.earlyLeave).length,
      incomplete: 0,
      averageWorkedSeconds: present.length ? Math.round(present.reduce((s, r) => s + r.workedSeconds, 0) / present.length) : 0,
      monthAttendancePercent: null as number | null,
    };
    // Month-to-date attendance %: total credit over total eligible working days across the roster.
    let credit = 0;
    let eligible = 0;
    for (const m of month.values()) {
      const s = periodStats(m.days);
      if (s.attendancePercent === null) continue;
      const denom = s.workingDays - s.leaveDays - m.days.filter((d) => d.status === "NOT_STARTED").length;
      eligible += denom;
      credit += (s.attendancePercent / 100) * denom;
    }
    kpis.monthAttendancePercent = eligible > 0 ? Math.round((credit / eligible) * 100) : null;

    const incomplete = await incompleteSessions(tx, policy, ids ?? null, now);
    kpis.incomplete = incomplete.length;

    const rows = sortRows(
      allRows.filter((r) => filteredIds.has(r.employeeId) && matchesTab(r, tab)),
      q.sort,
      q.dir,
    );
    const page = Math.min(q.page, Math.max(1, Math.ceil(rows.length / PAGE)));
    const departments = [...new Set(everyone.map((e) => e.department))].sort((a, b) => a.localeCompare(b));
    const companies = [...new Map(everyone.map((e) => [e.companyId, e.company.name])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      date,
      today,
      timezone: policy.timezone,
      shift: { start: policy.shiftStart, end: policy.shiftEnd, graceMinutes: policy.graceMinutes },
      tab,
      kpis,
      rows: rows.slice((page - 1) * PAGE, page * PAGE),
      total: rows.length,
      page,
      pageSize: PAGE,
      incomplete,
      departments,
      companies,
      canManage: can(actor, "attendance:manage"),
    };
  });
}
export type AttendanceOverview = Awaited<ReturnType<typeof getAttendanceOverview>>;

/** Attendance history: one row per employee per day over a range (max 62 days), paginated. */
export async function getAttendanceHistory(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const scope = await attendanceScope(db, actor, ctx);
  const q = historyQuerySchema.parse(raw ?? {});
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const today = localDate(now, policy.timezone);
  let to = q.to && q.to <= today ? q.to : today;
  let from = q.from ?? addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  if (daysInclusive(from, to) > 62) from = addDays(to, -61);
  return withRls(db, actor, async (tx) => {
    const ids = scope.all ? (q.employee ? [q.employee] : undefined) : q.employee ? scope.ids.filter((i) => i === q.employee) : scope.ids;
    const roster = await loadRoster(tx, { ids, q: q.q, department: q.department });
    const range = await summarizeRange(tx, policy, roster, from, to, now);
    const rows: (AttendanceRow & { date: string })[] = [];
    for (const date of [...new Set(range.values().next().value?.days.map((d) => d.date) ?? [])].reverse()) {
      for (const e of roster) {
        const m = range.get(e.id)!;
        const d = m.days.find((x) => x.date === date)!;
        if (d.status === "UPCOMING" || d.status === "NOT_EMPLOYED") continue;
        rows.push({ ...toRow(e, d, m.sessions.filter((s) => s.workDate === date)), date });
      }
    }
    const page = Math.min(q.page, Math.max(1, Math.ceil(rows.length / PAGE)));
    return { from, to, today, timezone: policy.timezone, rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page, pageSize: PAGE, allRows: rows };
  });
}

/** One employee's month for HR/managers: day summaries, sessions, immutable events and corrections. */
export async function getEmployeeAttendance(db: Db, actor: Actor, employeeId: string, rawMonth: unknown, ctx: RequestContext) {
  if (!can(actor, "attendance:read") && !(await managesEmployee(db, actor, employeeId))) {
    await authorize(db, actor, "attendance:read", ctx, { type: "employee", id: employeeId });
  }
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const month = monthSchema.parse(rawMonth) ?? localDate(now, policy.timezone).slice(0, 7);
  const { start, end } = monthBounds(month);
  return withRls(db, actor, async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { ...rosterSelect, employmentStatus: true } });
    if (!e) throw notFound("Employee");
    const m = (await summarizeRange(tx, policy, [e], start, end, now)).get(employeeId)!;
    const [events, corrections] = await Promise.all([
      tx.attendanceEvent.findMany({
        where: { employeeId, occurredAt: { gte: new Date(`${addDays(start, -1)}T00:00:00Z`), lte: new Date(`${addDays(end, 2)}T00:00:00Z`) } },
        orderBy: { occurredAt: "desc" },
        take: 300,
        select: { id: true, type: true, occurredAt: true, actorId: true, sessionId: true, metadata: true },
      }),
      tx.attendanceCorrection.findMany({
        where: { employeeId, workDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, status: true, workDate: true, reason: true, reviewNote: true, createdAt: true, before: true, after: true, requestedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } },
      }),
    ]);
    const actorIds = [...new Set(events.map((ev) => ev.actorId).filter((x): x is string => Boolean(x)))];
    const names = new Map((await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      employee: {
        id: e.id,
        employeeCode: e.employeeCode,
        name: e.displayName,
        department: e.department,
        designation: e.jobTitle,
        company: e.company.name,
        photoUpdatedAt: e.photoKey ? (e.photoUpdatedAt?.toISOString() ?? null) : null,
      },
      month,
      today: localDate(now, policy.timezone),
      timezone: policy.timezone,
      days: m.days.map(serializeDay),
      sessions: m.sessions.map((s) => ({ ...serializeSession(s), stale: isStale(s, policy, now) })),
      stats: periodStats(m.days),
      events: events.map((ev) => ({ id: ev.id.toString(), type: ev.type, occurredAt: ev.occurredAt.toISOString(), actor: ev.actorId ? (names.get(ev.actorId) ?? "Former user") : "System", sessionId: ev.sessionId, metadata: ev.metadata })),
      corrections: corrections.map((c) => ({ ...c, workDate: c.workDate.toISOString().slice(0, 10), createdAt: c.createdAt.toISOString(), requestedBy: c.requestedBy?.name ?? null, reviewedBy: c.reviewedBy?.name ?? null })),
      canManage: can(actor, "attendance:manage"),
    };
  });
}
export type EmployeeAttendance = Awaited<ReturnType<typeof getEmployeeAttendance>>;

export interface MonthlyReportRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  company: string;
  workingDays: number;
  present: number;
  halfDays: number;
  absent: number;
  leaveDays: number;
  lateDays: number;
  workedSeconds: number;
  attendancePercent: number | null;
}

/** Monthly attendance report for the roster (filters: department, company, search). */
export async function getMonthlyReport(db: Db, actor: Actor, raw: { month?: unknown; department?: string; company?: string; q?: string }, ctx: RequestContext) {
  const scope = await attendanceScope(db, actor, ctx);
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const month = monthSchema.parse(raw.month) ?? localDate(now, policy.timezone).slice(0, 7);
  const { start, end } = monthBounds(month);
  if (start > localDate(now, policy.timezone)) throw new AppError("VALIDATION", "Choose a month that has started");
  return withRls(db, actor, async (tx) => {
    const roster = await loadRoster(tx, {
      ids: scope.all ? undefined : scope.ids,
      department: raw.department?.slice(0, 120) || undefined,
      company: raw.company && /^[0-9a-f-]{36}$/i.test(raw.company) ? raw.company : undefined,
      q: raw.q?.slice(0, 100) || undefined,
    });
    const range = await summarizeRange(tx, policy, roster, start, end, now);
    const rows: MonthlyReportRow[] = roster.map((e) => {
      const s = periodStats(range.get(e.id)!.days);
      return { employeeId: e.id, employeeCode: e.employeeCode, name: e.displayName, department: e.department, designation: e.jobTitle, company: e.company.name, ...s };
    });
    return { month, timezone: policy.timezone, rows };
  });
}
