import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { isConstraintViolation } from "@/server/db/errors";
import { AppError, notFound } from "@/lib/errors";
import { addDays, daysInclusive, eachDate, formatLongDate, localDate, monthBounds, weekdayOf } from "@/lib/time";
import { HALF_DAY_LABELS, leaveApplySchema, leaveDecisionSchema, leaveListQuerySchema, leaveRespondSchema, leaveTypeSchema, leaveTypeUpdateSchema, type LeaveStatus } from "@/features/leave/schema";
import { monthSchema } from "@/features/attendance/schema";
import { can } from "@/server/authorization/permissions";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";
import { emitEvent } from "./outbox";
import { notify, usersWithPermission } from "./notifications";
import { getAttendancePolicy, holidayLookup, listHolidays } from "./attendance-policy";
import { requireEmployee } from "./attendance";
import { managerUserIds } from "./team";

const MAX_SPAN_DAYS = 60;
const BACKDATE_DAYS = 30;
const ACTIVE: LeaveStatus[] = ["PENDING", "CLARIFICATION", "APPROVED"];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const num = (x: Prisma.Decimal | number | null) => (x === null ? null : Number(x));

/** Working days in a range for one employee (weekly offs and their holidays excluded). */
export async function countLeaveDays(db: Db | Tx, companyId: string, start: string, end: string, halfDay: string): Promise<number> {
  const policy = await getAttendancePolicy(db);
  const holidayFor = holidayLookup(await listHolidays(db, start, end));
  const working = eachDate(start, end).filter((x) => !policy.weeklyOffDays.includes(weekdayOf(x)) && !holidayFor(x, companyId)).length;
  return halfDay !== "NONE" ? Math.min(working, 0.5) : working;
}

export async function listLeaveTypes(db: Db | Tx, includeInactive = false) {
  const rows = await db.leaveType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((t) => ({ id: t.id, code: t.code, name: t.name, isPaid: t.isPaid, annualQuota: num(t.annualQuota), allowHalfDay: t.allowHalfDay, isActive: t.isActive }));
}
export type LeaveTypeView = Awaited<ReturnType<typeof listLeaveTypes>>[number];

/** Days used (approved) and requested (pending/clarification) per leave type in a calendar year. */
async function usage(tx: Db | Tx, employeeId: string, year: number, excludeId?: string) {
  const rows = await tx.leaveRequest.groupBy({
    by: ["leaveTypeId", "status"],
    where: { employeeId, status: { in: ACTIVE }, startDate: { gte: d(`${year}-01-01`), lte: d(`${year}-12-31`) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { days: true },
  });
  const map = new Map<string, { used: number; pending: number }>();
  for (const r of rows) {
    const cur = map.get(r.leaveTypeId) ?? { used: 0, pending: 0 };
    if (r.status === "APPROVED") cur.used += Number(r._sum.days ?? 0);
    else cur.pending += Number(r._sum.days ?? 0);
    map.set(r.leaveTypeId, cur);
  }
  return map;
}

const requestSelect = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  halfDay: true,
  days: true,
  reason: true,
  status: true,
  reviewNote: true,
  employeeNote: true,
  decidedAt: true,
  createdAt: true,
  leaveType: { select: { id: true, code: true, name: true } },
  reviewer: { select: { name: true } },
  employee: { select: { displayName: true, employeeCode: true, department: true, jobTitle: true, photoKey: true, photoUpdatedAt: true } },
} as const;

type RawRequest = Prisma.LeaveRequestGetPayload<{ select: typeof requestSelect }>;
const toView = (r: RawRequest) => ({
  id: r.id,
  employeeId: r.employeeId,
  employeeName: r.employee.displayName,
  employeeCode: r.employee.employeeCode,
  department: r.employee.department,
  designation: r.employee.jobTitle,
  photoUpdatedAt: r.employee.photoKey ? (r.employee.photoUpdatedAt?.toISOString() ?? null) : null,
  leaveType: r.leaveType,
  startDate: ymd(r.startDate),
  endDate: ymd(r.endDate),
  halfDay: r.halfDay,
  days: Number(r.days),
  reason: r.reason,
  status: r.status,
  reviewNote: r.reviewNote,
  employeeNote: r.employeeNote,
  reviewer: r.reviewer?.name ?? null,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});
export type LeaveRequestView = ReturnType<typeof toView>;

/** The signed-in employee's balances for a year and their requests. */
export async function getMyLeave(db: Db, actor: Actor, rawYear?: unknown) {
  const employeeId = requireEmployee(actor);
  const policy = await getAttendancePolicy(db);
  const today = localDate(new Date(), policy.timezone);
  const y = Number(rawYear);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(today.slice(0, 4));
  const types = await listLeaveTypes(db);
  return withRls(db, actor, async (tx) => {
    const used = await usage(tx, employeeId, year);
    const requests = await tx.leaveRequest.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take: 200, select: requestSelect });
    return {
      year,
      today,
      types,
      balances: types.map((t) => {
        const u = used.get(t.id) ?? { used: 0, pending: 0 };
        return { ...t, used: u.used, pending: u.pending, remaining: t.annualQuota === null ? null : Math.max(0, t.annualQuota - u.used - u.pending) };
      }),
      requests: requests.map(toView),
    };
  });
}

async function hrApprovers(db: Db | Tx) {
  return usersWithPermission(db, "leave:manage");
}

/** Employee applies for leave. Overlaps are rejected by the database's exclusion constraint. */
export async function applyLeave(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = leaveApplySchema.parse(raw);
  await enforceRateLimit(db, "self-service", actor.id, RATE_RULES.selfService);
  const policy = await getAttendancePolicy(db);
  const today = localDate(new Date(), policy.timezone);
  if (input.startDate < addDays(today, -BACKDATE_DAYS)) throw new AppError("VALIDATION", `Leave can be applied up to ${BACKDATE_DAYS} days back. Ask HR for older dates.`, { field: "startDate" });
  if (daysInclusive(input.startDate, input.endDate) > MAX_SPAN_DAYS) throw new AppError("VALIDATION", `One request can cover at most ${MAX_SPAN_DAYS} days`, { field: "endDate" });
  if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) throw new AppError("VALIDATION", "Leave across two calendar years needs two requests", { field: "endDate" });
  const type = await db.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type?.isActive) throw new AppError("VALIDATION", "Choose an available leave type", { field: "leaveTypeId" });
  if (input.halfDay !== "NONE" && !type.allowHalfDay) throw new AppError("VALIDATION", `${type.name} cannot be taken as a half day`, { field: "halfDay" });
  const approvers = await hrApprovers(db);
  const managers = await managerUserIds(db, employeeId);
  try {
    return await withRls(db, actor, async (tx) => {
      const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { displayName: true, companyId: true } });
      if (!emp) throw notFound("Employee");
      const days = await countLeaveDays(tx, emp.companyId, input.startDate, input.endDate, input.halfDay);
      if (days <= 0) throw new AppError("VALIDATION", "Those dates are weekly offs or holidays. No leave is needed.", { field: "startDate" });
      if (type.annualQuota !== null) {
        const u = (await usage(tx, employeeId, Number(input.startDate.slice(0, 4)))).get(type.id) ?? { used: 0, pending: 0 };
        const left = Number(type.annualQuota) - u.used - u.pending;
        if (days > left) throw new AppError("VALIDATION", `Not enough ${type.name.toLowerCase()} left: ${Math.max(0, left)} day(s) available`, { field: "leaveTypeId" });
      }
      const r = await tx.leaveRequest.create({
        data: { employeeId, leaveTypeId: type.id, startDate: d(input.startDate), endDate: d(input.endDate), halfDay: input.halfDay, days: new Prisma.Decimal(days), reason: input.reason },
        select: { id: true },
      });
      await recordAudit(tx, ctx, { actor, action: "leave.requested", targetType: "employee", targetId: employeeId, metadata: { leaveId: r.id, type: type.code, days, startDate: input.startDate, endDate: input.endDate } });
      await notify(tx, approvers, {
        type: "leave.requested",
        title: `${emp.displayName} applied for ${type.name.toLowerCase()}`,
        body: `${formatLongDate(input.startDate)}${input.endDate !== input.startDate ? ` – ${formatLongDate(input.endDate)}` : ""} · ${days} day(s)${input.halfDay !== "NONE" ? ` (${HALF_DAY_LABELS[input.halfDay]})` : ""}`,
        link: "/leave",
        entityType: "leave_request",
        entityId: r.id,
      });
      await emitEvent(tx, "leave.changed", { leaveId: r.id, employeeId, scope: "leave:read", audience: [actor.id, ...managers] });
      return { id: r.id, days };
    });
  } catch (err) {
    if (isConstraintViolation(err)) throw new AppError("CONFLICT", "You already have leave requested or approved on some of these dates.");
    throw err;
  }
}

/** Employee cancels a pending request, or approved leave that has not started yet. */
export async function cancelLeave(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const policy = await getAttendancePolicy(db);
  const today = localDate(new Date(), policy.timezone);
  const approvers = await hrApprovers(db);
  return withRls(db, actor, async (tx) => {
    const r = await tx.leaveRequest.findFirst({ where: { id, employeeId }, select: { status: true, startDate: true, employee: { select: { displayName: true } }, leaveType: { select: { name: true } } } });
    if (!r) throw notFound("Leave request");
    if (!ACTIVE.includes(r.status)) throw new AppError("INVALID_STATE", "This request is already closed");
    if (r.status === "APPROVED" && ymd(r.startDate) <= today) throw new AppError("INVALID_STATE", "Leave that has started can only be changed by HR");
    await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", version: { increment: 1 } } });
    await recordAudit(tx, ctx, { actor, action: "leave.cancelled", targetType: "employee", targetId: employeeId, metadata: { leaveId: id, wasApproved: r.status === "APPROVED" } });
    if (r.status === "APPROVED") {
      await notify(tx, approvers, { type: "leave.cancelled", title: `${r.employee.displayName} cancelled approved ${r.leaveType.name.toLowerCase()}`, body: formatLongDate(ymd(r.startDate)), link: "/leave", entityType: "leave_request", entityId: id });
    }
    await emitEvent(tx, "leave.changed", { leaveId: id, employeeId, scope: "leave:read", audience: [actor.id] });
  });
}

/** Employee answers HR's clarification question; the request goes back to pending. */
export async function respondToLeaveClarification(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = leaveRespondSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const r = await tx.leaveRequest.findFirst({ where: { id, employeeId }, select: { status: true, reviewerId: true, employee: { select: { displayName: true } } } });
    if (!r) throw notFound("Leave request");
    if (r.status !== "CLARIFICATION") throw new AppError("INVALID_STATE", "HR has not asked for clarification on this request");
    await tx.leaveRequest.update({ where: { id }, data: { status: "PENDING", employeeNote: input.note, version: { increment: 1 } } });
    await recordAudit(tx, ctx, { actor, action: "leave.clarified", targetType: "employee", targetId: employeeId, metadata: { leaveId: id } });
    const to = r.reviewerId ? [r.reviewerId] : await hrApprovers(tx);
    await notify(tx, to, { type: "leave.clarified", title: `${r.employee.displayName} replied about their leave`, body: input.note.slice(0, 200), link: "/leave", entityType: "leave_request", entityId: id });
    await emitEvent(tx, "leave.changed", { leaveId: id, employeeId, scope: "leave:read", audience: [actor.id] });
  });
}

/** HR: approve, reject or ask for clarification. Approval re-checks the quota. */
export async function decideLeave(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "leave:manage", ctx, { type: "leave_request", id });
  const input = leaveDecisionSchema.parse(raw);
  const ref = await db.leaveRequest.findUnique({ where: { id }, select: { employeeId: true } });
  if (!ref) throw notFound("Leave request");
  const recipients = (await db.user.findMany({ where: { employeeId: ref.employeeId, isActive: true }, select: { id: true } })).map((u) => u.id);
  const managers = await managerUserIds(db, ref.employeeId);
  return withRls(db, actor, async (tx) => {
    const r = await tx.leaveRequest.findUnique({ where: { id }, select: { id: true, status: true, version: true, employeeId: true, startDate: true, endDate: true, days: true, leaveType: { select: { id: true, name: true, annualQuota: true } } } });
    if (!r) throw notFound("Leave request");
    const allowedFrom: LeaveStatus[] = input.decision === "CLARIFY" ? ["PENDING"] : ["PENDING", "CLARIFICATION"];
    if (!allowedFrom.includes(r.status)) throw new AppError("INVALID_STATE", "This request has already been decided");
    if (input.decision === "APPROVE" && r.leaveType.annualQuota !== null) {
      const u = (await usage(tx, r.employeeId, r.startDate.getUTCFullYear(), r.id)).get(r.leaveType.id) ?? { used: 0, pending: 0 };
      if (u.used + Number(r.days) > Number(r.leaveType.annualQuota)) throw new AppError("INVALID_STATE", `Approving would exceed the ${r.leaveType.name.toLowerCase()} quota (${u.used} of ${Number(r.leaveType.annualQuota)} already used)`);
    }
    const status: LeaveStatus = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "CLARIFICATION";
    const res = await tx.leaveRequest.updateMany({
      where: { id, version: r.version },
      data: { status, reviewerId: actor.id, reviewNote: input.note ?? null, decidedAt: status === "CLARIFICATION" ? null : new Date(), version: { increment: 1 } },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "This request changed meanwhile. Refresh and try again.");
    await recordAudit(tx, ctx, {
      actor,
      action: status === "APPROVED" ? "leave.approved" : status === "REJECTED" ? "leave.rejected" : "leave.clarification_requested",
      targetType: "employee",
      targetId: r.employeeId,
      metadata: { leaveId: id, from: r.status, to: status, days: Number(r.days) },
    });
    const when = `${formatLongDate(ymd(r.startDate))}${ymd(r.endDate) !== ymd(r.startDate) ? ` – ${formatLongDate(ymd(r.endDate))}` : ""}`;
    await notify(tx, recipients, {
      type: `leave.${status.toLowerCase()}`,
      title: status === "APPROVED" ? `Your ${r.leaveType.name.toLowerCase()} was approved` : status === "REJECTED" ? `Your ${r.leaveType.name.toLowerCase()} was rejected` : "HR has a question about your leave",
      body: `${when}${input.note ? ` · ${input.note}` : ""}`,
      link: "/me/leave",
      entityType: "leave_request",
      entityId: id,
    });
    await emitEvent(tx, "leave.changed", { leaveId: id, employeeId: r.employeeId, scope: "leave:read", audience: [...recipients, ...managers] });
    if (status === "APPROVED") await emitEvent(tx, "attendance.changed", { employeeId: r.employeeId, scope: "attendance:read", audience: [...recipients, ...managers] });
    return { status };
  });
}

/** HR (leave:read) sees every request; team managers see their team's (RLS enforces the same). */
export async function listLeaveRequests(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  if (!can(actor, "leave:read") && actor.role !== "TEAM_MANAGER") await authorize(db, actor, "leave:read", ctx, { type: "leave_request" });
  const q = leaveListQuerySchema.parse(raw ?? {});
  const where: Prisma.LeaveRequestWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(actor.role === "TEAM_MANAGER" && !can(actor, "leave:read") ? { employeeId: { not: actor.employeeId ?? undefined } } : {}),
    employee: {
      ...(q.department ? { department: { equals: q.department, mode: "insensitive" } } : {}),
      ...(q.q ? { OR: [{ displayName: { contains: q.q, mode: "insensitive" } }, { employeeCode: { startsWith: q.q, mode: "insensitive" } }] } : {}),
    },
  };
  return withRls(db, actor, async (tx) => {
    const [total, rows, pending] = await Promise.all([
      tx.leaveRequest.count({ where }),
      tx.leaveRequest.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (q.page - 1) * 25, take: 25, select: requestSelect }),
      tx.leaveRequest.count({ where: { status: { in: ["PENDING", "CLARIFICATION"] }, ...(where.employeeId ? { employeeId: where.employeeId } : {}) } }),
    ]);
    return { items: rows.map(toView), total, page: q.page, pageSize: 25, pending, canDecide: can(actor, "leave:manage") };
  });
}

/** Who is on approved (and pending) leave each day of a month. */
export async function getLeaveCalendar(db: Db, actor: Actor, rawMonth: unknown, ctx: RequestContext) {
  if (!can(actor, "leave:read") && actor.role !== "TEAM_MANAGER") await authorize(db, actor, "leave:read", ctx, { type: "leave_request" });
  const policy = await getAttendancePolicy(db);
  const month = monthSchema.parse(rawMonth) ?? localDate(new Date(), policy.timezone).slice(0, 7);
  const { start, end } = monthBounds(month);
  return withRls(db, actor, async (tx) => {
    const rows = await tx.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "PENDING", "CLARIFICATION"] }, startDate: { lte: d(end) }, endDate: { gte: d(start) } },
      orderBy: { startDate: "asc" },
      take: 1000,
      select: requestSelect,
    });
    const holidays = await listHolidays(tx, start, end);
    return { month, start, end, weeklyOffDays: policy.weeklyOffDays, holidays, items: rows.map(toView) };
  });
}

export async function createLeaveType(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "policy:manage", ctx, { type: "leave_type" });
  const input = leaveTypeSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    if (await tx.leaveType.findUnique({ where: { code: input.code }, select: { id: true } })) throw new AppError("CONFLICT", "That code is already used", { field: "code" });
    const count = await tx.leaveType.count();
    const t = await tx.leaveType.create({ data: { ...input, annualQuota: input.annualQuota === null ? null : new Prisma.Decimal(input.annualQuota), sortOrder: count + 1 }, select: { id: true } });
    await recordAudit(tx, ctx, { actor, action: "leave.type_created", targetType: "leave_type", targetId: t.id, metadata: { code: input.code } });
    return t;
  });
}

export async function updateLeaveType(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "policy:manage", ctx, { type: "leave_type", id });
  const input = leaveTypeUpdateSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const t = await tx.leaveType.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw notFound("Leave type");
    if (input.code && (await tx.leaveType.findFirst({ where: { code: input.code, id: { not: id } }, select: { id: true } }))) throw new AppError("CONFLICT", "That code is already used", { field: "code" });
    await tx.leaveType.update({
      where: { id },
      data: { ...input, ...(input.annualQuota !== undefined ? { annualQuota: input.annualQuota === null ? null : new Prisma.Decimal(input.annualQuota) } : {}) },
    });
    await recordAudit(tx, ctx, { actor, action: "leave.type_updated", targetType: "leave_type", targetId: id, metadata: { changed: Object.keys(input) } });
    return { ok: true };
  });
}
