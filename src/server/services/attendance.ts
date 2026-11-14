import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { isConstraintViolation } from "@/server/db/errors";
import { AppError } from "@/lib/errors";
import { formatClock, formatDuration, localDate, monthBounds } from "@/lib/time";
import { LOCATION_LABELS, monthSchema, punchInSchema, punchOutSchema } from "@/features/attendance/schema";
import { isStale, periodStats } from "@/features/attendance/rules";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { notify, usersWithPermission } from "./notifications";
import { managerUserIds } from "./team";
import { getAttendancePolicy } from "./attendance-policy";
import { serializeDay, serializeSession, sessionSelect, summarizeRange, toSessionRow } from "./attendance-summary";

/** Self-service actions need a login linked to an employee record. */
export function requireEmployee(actor: Actor): string {
  if (!actor.employeeId) throw new AppError("FORBIDDEN", "Your login is not linked to an employee record. Ask HR to link it.");
  return actor.employeeId;
}

const lockEmployee = (tx: Tx, employeeId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${employeeId}`}))`;

/** Real-time audience for an employee's attendance: themselves and their team managers (HR via scope). */
async function attendanceAudience(db: Db | Tx, employeeId: string, actorId: string): Promise<string[]> {
  const ids = await db.user.findMany({ where: { employeeId, isActive: true }, select: { id: true } });
  return [...new Set([actorId, ...ids.map((u) => u.id), ...(await managerUserIds(db, employeeId))])];
}

/** Attendance card data for the signed-in employee: policy, today's sessions and status. */
export async function getMyAttendanceToday(db: Db, actor: Actor) {
  const employeeId = requireEmployee(actor);
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const today = localDate(now, policy.timezone);
  return withRls(db, actor, async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, companyId: true, joiningDate: true } });
    if (!employee) throw new AppError("FORBIDDEN", "Employee record not found");
    const [days, openRaw] = await Promise.all([
      summarizeRange(tx, policy, [employee], today, today, now),
      tx.attendanceSession.findFirst({ where: { employeeId, status: "OPEN" }, select: sessionSelect }),
    ]);
    const mine = days.get(employeeId)!;
    const open = openRaw ? toSessionRow(openRaw) : null;
    return {
      now: now.toISOString(),
      today,
      timezone: policy.timezone,
      policy: {
        shiftStart: policy.shiftStart,
        shiftEnd: policy.shiftEnd,
        allowedLocations: policy.allowedLocations,
        allowMultipleSessions: policy.allowMultipleSessions,
        logoutPolicy: policy.logoutPolicy,
        maxSessionHours: policy.maxSessionHours,
      },
      open: open ? { ...serializeSession(open), stale: isStale(open, policy, now) } : null,
      sessions: mine.sessions.map(serializeSession),
      summary: serializeDay(mine.days[0]!),
    };
  });
}
export type MyAttendanceToday = Awaited<ReturnType<typeof getMyAttendanceToday>>;

/**
 * Punch IN. The timestamp is generated here, never taken from the client. A per-employee advisory
 * lock serialises concurrent requests (two tabs, double clicks); the unique "one open session"
 * index and the no-overlap exclusion constraint are the final guards.
 */
export async function punchIn(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = punchInSchema.parse(raw);
  await enforceRateLimit(db, "punch", actor.id, RATE_RULES.punch);
  const policy = await getAttendancePolicy(db);
  if (!policy.allowedLocations.includes(input.location)) throw new AppError("VALIDATION", `${LOCATION_LABELS[input.location]} is not allowed by the attendance policy`, { field: "location" });
  const [audience, punchWatchers] = await Promise.all([
    attendanceAudience(db, employeeId, actor.id),
    usersWithPermission(db, "attendance:read", { only: (u) => u.notifyPunches }),
  ]);
  try {
    return await withRls(db, actor, async (tx) => {
      await lockEmployee(tx, employeeId);
      const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { displayName: true, employmentStatus: true, archivedAt: true } });
      if (!emp || emp.employmentStatus !== "ACTIVE" || emp.archivedAt) throw new AppError("INVALID_STATE", "Your employee record is not active. Contact HR.");
      const open = await tx.attendanceSession.findFirst({ where: { employeeId, status: "OPEN" }, select: { punchInAt: true } });
      if (open) throw new AppError("CONFLICT", `You are already punched in (since ${formatClock(open.punchInAt, policy.timezone)}).`);
      const now = new Date();
      const workDate = localDate(now, policy.timezone);
      if (!policy.allowMultipleSessions) {
        const done = await tx.attendanceSession.count({ where: { employeeId, workDate: new Date(`${workDate}T00:00:00Z`), status: { not: "VOIDED" } } });
        if (done > 0) throw new AppError("INVALID_STATE", "The attendance policy allows one session per day. Ask HR if you need a correction.");
      }
      const session = await tx.attendanceSession.create({
        data: { employeeId, workDate: new Date(`${workDate}T00:00:00Z`), punchInAt: now, location: input.location, status: "OPEN", notes: input.notes ?? null, createdById: actor.id },
        select: sessionSelect,
      });
      await tx.attendanceEvent.createMany({ data: [{ employeeId, sessionId: session.id, type: "PUNCH_IN", occurredAt: now, actorId: actor.id, metadata: { location: input.location } }] });
      await recordAudit(tx, ctx, { actor, action: "attendance.punched_in", targetType: "employee", targetId: employeeId, metadata: { sessionId: session.id, location: input.location } });
      await emitEvent(tx, "attendance.changed", { employeeId, scope: "attendance:read", audience });
      const watchers = punchWatchers.filter((id) => id !== actor.id);
      if (watchers.length) {
        await notify(tx, watchers, {
          type: "attendance.punch_in",
          title: `${emp.displayName} punched in`,
          body: `${LOCATION_LABELS[input.location]} · ${formatClock(now, policy.timezone)}`,
          link: `/attendance/employees/${employeeId}`,
          entityType: "attendance_session",
          entityId: session.id,
        });
      }
      return serializeSession(toSessionRow(session));
    });
  } catch (err) {
    if (isConstraintViolation(err)) throw new AppError("CONFLICT", "You are already punched in.");
    throw err;
  }
}

/**
 * Punch OUT closes the open session with a server timestamp. Signing out of the app never does
 * this. Sessions that ran longer than the policy allows are closed but flagged for HR review.
 */
export async function punchOut(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = punchOutSchema.parse(raw);
  await enforceRateLimit(db, "punch", actor.id, RATE_RULES.punch);
  const policy = await getAttendancePolicy(db);
  const [audience, punchWatchers, reviewers] = await Promise.all([
    attendanceAudience(db, employeeId, actor.id),
    usersWithPermission(db, "attendance:read", { only: (u) => u.notifyPunches }),
    usersWithPermission(db, "attendance:manage"),
  ]);
  return withRls(db, actor, async (tx) => {
    await lockEmployee(tx, employeeId);
    const open = await tx.attendanceSession.findFirst({ where: { employeeId, status: "OPEN" }, select: { id: true, punchInAt: true, version: true, notes: true, employee: { select: { displayName: true } } } });
    if (!open) throw new AppError("INVALID_STATE", "You are not punched in.");
    let now = new Date();
    if (now <= open.punchInAt) now = new Date(open.punchInAt.getTime() + 1000);
    const durationSeconds = Math.floor((now.getTime() - open.punchInAt.getTime()) / 1000);
    const needsReview = durationSeconds > policy.maxSessionHours * 3600;
    const res = await tx.attendanceSession.updateMany({
      where: { id: open.id, status: "OPEN", version: open.version },
      data: {
        punchOutAt: now,
        status: "CLOSED",
        durationSeconds,
        needsReview,
        closedById: actor.id,
        version: { increment: 1 },
        ...(input.notes ? { notes: open.notes ? `${open.notes}\n${input.notes}`.slice(0, 600) : input.notes } : {}),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "Your attendance changed in another window. Refresh and try again.");
    await tx.attendanceEvent.createMany({ data: [{ employeeId, sessionId: open.id, type: "PUNCH_OUT", occurredAt: now, actorId: actor.id, metadata: { durationSeconds, needsReview } }] });
    await recordAudit(tx, ctx, { actor, action: "attendance.punched_out", targetType: "employee", targetId: employeeId, metadata: { sessionId: open.id, durationSeconds, needsReview } });
    await emitEvent(tx, "attendance.changed", { employeeId, scope: "attendance:read", audience });
    const name = open.employee.displayName;
    const watchers = punchWatchers.filter((id) => id !== actor.id);
    if (watchers.length) {
      await notify(tx, watchers, {
        type: "attendance.punch_out",
        title: `${name} punched out`,
        body: `${formatClock(now, policy.timezone)} · worked ${formatDuration(durationSeconds)}`,
        link: `/attendance/employees/${employeeId}`,
        entityType: "attendance_session",
        entityId: open.id,
      });
    }
    if (needsReview) {
      await notify(tx, reviewers, {
        type: "attendance.needs_review",
        title: `${name} closed a ${formatDuration(durationSeconds)} session`,
        body: "Longer than the policy allows (likely a missed punch-out). Please review and correct it.",
        link: `/attendance?tab=incomplete`,
        entityType: "attendance_session",
        entityId: open.id,
        dedupeKey: `review:${open.id}`,
      });
    }
    const closed = await tx.attendanceSession.findUniqueOrThrow({ where: { id: open.id }, select: sessionSelect });
    return serializeSession(toSessionRow(closed));
  });
}

/** The signed-in employee's month: one summary per day plus the sessions, and month totals. */
export async function getMyAttendanceMonth(db: Db, actor: Actor, rawMonth?: unknown) {
  const employeeId = requireEmployee(actor);
  const policy = await getAttendancePolicy(db);
  const now = new Date();
  const month = monthSchema.parse(rawMonth) ?? localDate(now, policy.timezone).slice(0, 7);
  const { start, end } = monthBounds(month);
  return withRls(db, actor, async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, companyId: true, joiningDate: true } });
    if (!employee) throw new AppError("FORBIDDEN", "Employee record not found");
    const mine = (await summarizeRange(tx, policy, [employee], start, end, now)).get(employeeId)!;
    const corrections = await tx.attendanceCorrection.findMany({
      where: { employeeId, workDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, status: true, workDate: true, reason: true, reviewNote: true, createdAt: true },
    });
    return {
      month,
      timezone: policy.timezone,
      correctionWindowDays: policy.correctionWindowDays,
      today: localDate(now, policy.timezone),
      days: mine.days.map(serializeDay),
      sessions: mine.sessions.map(serializeSession),
      stats: periodStats(mine.days),
      corrections: corrections.map((c) => ({ ...c, workDate: c.workDate.toISOString().slice(0, 10), createdAt: c.createdAt.toISOString() })),
    };
  });
}
export type MyAttendanceMonth = Awaited<ReturnType<typeof getMyAttendanceMonth>>;
