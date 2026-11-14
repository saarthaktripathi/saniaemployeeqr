import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { isConstraintViolation } from "@/server/db/errors";
import { AppError, notFound } from "@/lib/errors";
import { addDays, formatLongDate, localDate, timeToMinutes, zonedTimeToUtc } from "@/lib/time";
import { CORRECTION_LABELS, correctionReviewSchema, correctionSchema, hrCorrectionSchema } from "@/features/attendance/schema";
import { can } from "@/server/authorization/permissions";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";
import { emitEvent } from "./outbox";
import { notify, usersWithPermission } from "./notifications";
import { getAttendancePolicy } from "./attendance-policy";
import { requireEmployee } from "./attendance";

type CorrectionInput = ReturnType<typeof correctionSchema.parse>;
const MAX_SESSION_MS = 24 * 3_600_000;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** Local HH:MM on workDate → UTC. A punch-out earlier than the punch-in means the next day. */
function resolveTimes(input: CorrectionInput, tz: string, existing?: { punchInAt: Date; punchOutAt: Date | null }) {
  const punchInAt = input.punchIn ? zonedTimeToUtc(input.workDate, input.punchIn, tz) : (existing?.punchInAt ?? null);
  let punchOutAt = existing?.punchOutAt ?? null;
  if (input.punchOut) {
    const inMinutes = input.punchIn ? timeToMinutes(input.punchIn) : null;
    const overnight = inMinutes !== null ? timeToMinutes(input.punchOut) <= inMinutes : false;
    punchOutAt = zonedTimeToUtc(overnight ? addDays(input.workDate, 1) : input.workDate, input.punchOut, tz);
    // Changing only the punch-out of an existing session: roll to the next day if needed.
    if (!input.punchIn && punchInAt && punchOutAt <= punchInAt) punchOutAt = new Date(punchOutAt.getTime() + 86_400_000);
  }
  return { punchInAt, punchOutAt };
}

function assertSaneTimes(punchInAt: Date | null, punchOutAt: Date | null, now: Date) {
  if (!punchInAt) throw new AppError("VALIDATION", "Enter the punch-in time", { field: "punchIn" });
  if (punchInAt > now || (punchOutAt && punchOutAt > now)) throw new AppError("VALIDATION", "Times cannot be in the future", { field: "punchOut" });
  if (punchOutAt && punchOutAt <= punchInAt) throw new AppError("VALIDATION", "Punch-out must be after punch-in", { field: "punchOut" });
  if (punchOutAt && punchOutAt.getTime() - punchInAt.getTime() > MAX_SESSION_MS) throw new AppError("VALIDATION", "A session cannot be longer than 24 hours", { field: "punchOut" });
}

const snapshot = (s: { punchInAt: Date; punchOutAt: Date | null; status: string; location: string } | null) =>
  s ? { punchInAt: s.punchInAt.toISOString(), punchOutAt: s.punchOutAt?.toISOString() ?? null, status: s.status, location: s.location } : null;

/**
 * Applies a correction to the attendance data (inside the caller's RLS transaction). Returns the
 * before/after snapshots. Overlaps are rejected by the database's exclusion constraint.
 */
async function applyCorrection(tx: Tx, actor: Actor, employeeId: string, input: CorrectionInput, tz: string, correctionId: string) {
  const now = new Date();
  const session = input.sessionId
    ? await tx.attendanceSession.findFirst({ where: { id: input.sessionId, employeeId }, select: { id: true, punchInAt: true, punchOutAt: true, status: true, location: true, workDate: true, version: true } })
    : null;
  if (input.sessionId && !session) throw notFound("Session");
  if (session?.status === "VOIDED") throw new AppError("INVALID_STATE", "That session was removed and cannot be changed");
  const before = snapshot(session);
  let sessionId = session?.id ?? null;
  let eventType: "SESSION_ADDED" | "SESSION_CORRECTED" | "SESSION_RESOLVED" | "SESSION_VOIDED";
  let after: ReturnType<typeof snapshot>;

  if (input.kind === "VOID_SESSION") {
    const punchOutAt = session!.punchOutAt ?? new Date(Math.max(now.getTime(), session!.punchInAt.getTime() + 1000));
    await tx.attendanceSession.update({ where: { id: session!.id }, data: { status: "VOIDED", punchOutAt, needsReview: false, reviewNote: input.reason, closedById: session!.punchOutAt ? undefined : actor.id, version: { increment: 1 } } });
    eventType = "SESSION_VOIDED";
    after = { ...before!, punchOutAt: punchOutAt.toISOString(), status: "VOIDED" };
  } else {
    const { punchInAt, punchOutAt } = resolveTimes(input, tz, input.kind === "ADD_SESSION" ? undefined : session!);
    if (input.kind === "CLOSE_SESSION" && session!.status !== "OPEN") throw new AppError("INVALID_STATE", "That session is already closed");
    if (input.kind !== "ADD_SESSION" && !punchOutAt && session!.status !== "OPEN") throw new AppError("VALIDATION", "Enter the punch-out time", { field: "punchOut" });
    assertSaneTimes(punchInAt, punchOutAt, now);
    const status = punchOutAt ? "CORRECTED" : "OPEN";
    const durationSeconds = punchOutAt ? Math.floor((punchOutAt.getTime() - punchInAt!.getTime()) / 1000) : null;
    const workDate = localDate(punchInAt!, tz);
    if (input.kind === "ADD_SESSION") {
      const created = await tx.attendanceSession.create({
        data: { employeeId, workDate: day(workDate), punchInAt: punchInAt!, punchOutAt, location: input.location ?? "OFFICE", status, durationSeconds, createdById: actor.id, closedById: actor.id, reviewNote: input.reason },
        select: { id: true },
      });
      sessionId = created.id;
      eventType = "SESSION_ADDED";
    } else {
      const res = await tx.attendanceSession.updateMany({
        where: { id: session!.id, version: session!.version },
        data: { punchInAt: punchInAt!, punchOutAt, status, durationSeconds, workDate: day(workDate), needsReview: false, reviewNote: input.reason, ...(input.location ? { location: input.location } : {}), ...(punchOutAt && !session!.punchOutAt ? { closedById: actor.id } : {}), version: { increment: 1 } },
      });
      if (res.count !== 1) throw new AppError("CONFLICT", "The session changed meanwhile. Refresh and try again.");
      eventType = input.kind === "CLOSE_SESSION" || (session!.status === "OPEN" && punchOutAt) ? "SESSION_RESOLVED" : "SESSION_CORRECTED";
    }
    after = { punchInAt: punchInAt!.toISOString(), punchOutAt: punchOutAt?.toISOString() ?? null, status, location: input.location ?? session?.location ?? "OFFICE" };
  }
  await tx.attendanceEvent.createMany({
    data: [{ employeeId, sessionId, type: eventType, occurredAt: now, actorId: actor.id, metadata: { correctionId, kind: input.kind, before, after, reason: input.reason } as Prisma.InputJsonValue }],
  });
  return { sessionId, before, after };
}

function mapOverlap(err: unknown): never {
  if (isConstraintViolation(err)) throw new AppError("CONFLICT", "These times overlap another session (or an open session) for this employee.");
  throw err;
}

/** Employee: request a correction for one of their own days within the policy window. */
export async function requestCorrection(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = correctionSchema.parse(raw);
  await enforceRateLimit(db, "self-service", actor.id, RATE_RULES.selfService);
  const policy = await getAttendancePolicy(db);
  const today = localDate(new Date(), policy.timezone);
  if (input.workDate > today) throw new AppError("VALIDATION", "You cannot correct a future day", { field: "workDate" });
  if (input.workDate < addDays(today, -policy.correctionWindowDays)) {
    throw new AppError("VALIDATION", `Corrections can be requested for the last ${policy.correctionWindowDays} days. Ask HR for older changes.`, { field: "workDate" });
  }
  if (input.kind !== "VOID_SESSION") {
    const { punchInAt, punchOutAt } = resolveTimes(input, policy.timezone);
    if (input.kind === "ADD_SESSION") assertSaneTimes(punchInAt, punchOutAt, new Date());
  }
  const reviewers = await usersWithPermission(db, "attendance:manage");
  return withRls(db, actor, async (tx) => {
    if (input.sessionId) {
      const s = await tx.attendanceSession.findFirst({ where: { id: input.sessionId, employeeId }, select: { workDate: true, status: true } });
      if (!s) throw notFound("Session");
      if (s.workDate.toISOString().slice(0, 10) !== input.workDate) throw new AppError("VALIDATION", "That session belongs to a different day", { field: "sessionId" });
      const pending = await tx.attendanceCorrection.count({ where: { sessionId: input.sessionId, status: "PENDING" } });
      if (pending) throw new AppError("CONFLICT", "There is already a pending correction for this session");
    }
    const { punchInAt, punchOutAt } = input.kind === "VOID_SESSION" ? { punchInAt: null, punchOutAt: null } : resolveTimes(input, policy.timezone);
    const c = await tx.attendanceCorrection.create({
      data: { employeeId, sessionId: input.sessionId ?? null, kind: input.kind, workDate: day(input.workDate), punchInAt, punchOutAt, location: input.location ?? null, reason: input.reason, requestedById: actor.id },
      select: { id: true, employee: { select: { displayName: true } } },
    });
    await recordAudit(tx, ctx, { actor, action: "attendance.correction_requested", targetType: "employee", targetId: employeeId, metadata: { correctionId: c.id, kind: input.kind, workDate: input.workDate } });
    await notify(tx, reviewers, {
      type: "attendance.correction_requested",
      title: `${c.employee.displayName} requested an attendance correction`,
      body: `${CORRECTION_LABELS[input.kind]} · ${formatLongDate(input.workDate)}`,
      link: "/attendance/corrections",
      entityType: "attendance_correction",
      entityId: c.id,
    });
    await emitEvent(tx, "attendance.changed", { employeeId, scope: "attendance:read", audience: [actor.id] });
    return { id: c.id };
  });
}

export async function cancelCorrection(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  await withRls(db, actor, async (tx) => {
    const res = await tx.attendanceCorrection.updateMany({ where: { id, employeeId, status: "PENDING" }, data: { status: "CANCELLED", reviewedAt: new Date() } });
    if (res.count !== 1) throw notFound("Pending correction");
    await recordAudit(tx, ctx, { actor, action: "attendance.correction_cancelled", targetType: "employee", targetId: employeeId, metadata: { correctionId: id } });
  });
}

/** HR: apply or reject a pending request. Applying changes the attendance data in the same transaction. */
export async function reviewCorrection(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "attendance:manage", ctx, { type: "attendance_correction", id });
  const input = correctionReviewSchema.parse(raw);
  const policy = await getAttendancePolicy(db);
  return withRls(db, actor, async (tx) => {
    const c = await tx.attendanceCorrection.findUnique({
      where: { id },
      select: { id: true, employeeId: true, sessionId: true, kind: true, status: true, workDate: true, punchInAt: true, punchOutAt: true, location: true, reason: true, requestedById: true },
    });
    if (!c) throw notFound("Correction");
    if (c.status !== "PENDING") throw new AppError("INVALID_STATE", "This request has already been handled");
    const workDate = c.workDate.toISOString().slice(0, 10);
    let result: Awaited<ReturnType<typeof applyCorrection>> | null = null;
    if (input.decision === "APPLY") {
      const asInput: CorrectionInput = {
        kind: c.kind,
        sessionId: c.sessionId ?? undefined,
        workDate,
        reason: c.reason,
        location: c.location ?? undefined,
      };
      // Requested instants are stored in UTC; convert back to local HH:MM for one code path.
      const hhmm = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: policy.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) : undefined);
      asInput.punchIn = hhmm(c.punchInAt);
      asInput.punchOut = hhmm(c.punchOutAt);
      if (asInput.punchIn && localDate(c.punchInAt!, policy.timezone) !== workDate) asInput.workDate = localDate(c.punchInAt!, policy.timezone);
      result = await applyCorrection(tx, actor, c.employeeId, asInput, policy.timezone, c.id).catch(mapOverlap);
    }
    await tx.attendanceCorrection.update({
      where: { id },
      data: {
        status: input.decision === "APPLY" ? "APPLIED" : "REJECTED",
        reviewedById: actor.id,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        ...(result ? { before: (result.before ?? undefined) as Prisma.InputJsonValue | undefined, after: (result.after ?? undefined) as Prisma.InputJsonValue | undefined, sessionId: result.sessionId } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      actor,
      action: input.decision === "APPLY" ? "attendance.corrected" : "attendance.correction_rejected",
      targetType: "employee",
      targetId: c.employeeId,
      metadata: { correctionId: id, kind: c.kind, workDate, ...(result ? { before: result.before, after: result.after } : {}) },
    });
    if (c.requestedById) {
      await notify(tx, [c.requestedById], {
        type: input.decision === "APPLY" ? "attendance.correction_applied" : "attendance.correction_rejected",
        title: input.decision === "APPLY" ? "Your attendance correction was approved" : "Your attendance correction was rejected",
        body: `${formatLongDate(workDate)}${input.note ? ` · ${input.note}` : ""}`,
        link: `/me/attendance?month=${workDate.slice(0, 7)}`,
        entityType: "attendance_correction",
        entityId: id,
      });
    }
    await emitEvent(tx, "attendance.changed", { employeeId: c.employeeId, scope: "attendance:read", audience: c.requestedById ? [c.requestedById] : [] });
    return { status: input.decision === "APPLY" ? "APPLIED" : "REJECTED" };
  });
}

/** HR: correct attendance directly (also resolves incomplete sessions). Recorded as an applied correction. */
export async function correctAttendance(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "attendance:manage", ctx, { type: "attendance_correction" });
  const input = hrCorrectionSchema.parse(raw);
  const policy = await getAttendancePolicy(db);
  const employeeAudience = await db.user.findMany({ where: { employeeId: input.employeeId }, select: { id: true } });
  return withRls(db, actor, async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, displayName: true } });
    if (!emp) throw notFound("Employee");
    const c = await tx.attendanceCorrection.create({
      data: { employeeId: emp.id, sessionId: input.sessionId ?? null, kind: input.kind, status: "APPLIED", workDate: day(input.workDate), location: input.location ?? null, reason: input.reason, requestedById: actor.id, reviewedById: actor.id, reviewedAt: new Date() },
      select: { id: true },
    });
    const result = await applyCorrection(tx, actor, emp.id, input, policy.timezone, c.id).catch(mapOverlap);
    await tx.attendanceCorrection.update({
      where: { id: c.id },
      data: { sessionId: result.sessionId, punchInAt: result.after?.punchInAt ? new Date(result.after.punchInAt) : null, punchOutAt: result.after?.punchOutAt ? new Date(result.after.punchOutAt) : null, before: (result.before ?? undefined) as Prisma.InputJsonValue | undefined, after: (result.after ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    await recordAudit(tx, ctx, { actor, action: "attendance.corrected", targetType: "employee", targetId: emp.id, metadata: { correctionId: c.id, kind: input.kind, workDate: input.workDate, before: result.before, after: result.after, reason: input.reason } });
    const audience = employeeAudience.map((u) => u.id);
    if (audience.length) {
      await notify(tx, audience, {
        type: "attendance.corrected",
        title: "HR updated your attendance",
        body: `${formatLongDate(input.workDate)} · ${input.reason}`,
        link: `/me/attendance?month=${input.workDate.slice(0, 7)}`,
        entityType: "attendance_correction",
        entityId: c.id,
      });
    }
    await emitEvent(tx, "attendance.changed", { employeeId: emp.id, scope: "attendance:read", audience });
    return { id: c.id, sessionId: result.sessionId };
  });
}

export interface CorrectionRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  kind: string;
  status: string;
  workDate: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  reason: string;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  reviewedAt: string | null;
}

/** HR: the corrections queue (pending first) and audit trail of applied/rejected ones. */
export async function listCorrections(db: Db, actor: Actor, raw: { status?: string; employee?: string; page?: number }, ctx: RequestContext) {
  await authorize(db, actor, "attendance:read", ctx, { type: "attendance_correction" });
  const status = ["PENDING", "APPLIED", "REJECTED", "CANCELLED"].includes(raw.status ?? "") ? (raw.status as "PENDING") : undefined;
  const page = Math.max(1, Math.min(10_000, Number(raw.page) || 1));
  const where: Prisma.AttendanceCorrectionWhereInput = { ...(status ? { status } : {}), ...(raw.employee && /^[0-9a-f-]{36}$/i.test(raw.employee) ? { employeeId: raw.employee } : {}) };
  return withRls(db, actor, async (tx) => {
    const [total, pending, rows] = await Promise.all([
      tx.attendanceCorrection.count({ where }),
      tx.attendanceCorrection.count({ where: { status: "PENDING" } }),
      tx.attendanceCorrection.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
        select: {
          id: true,
          employeeId: true,
          kind: true,
          status: true,
          workDate: true,
          punchInAt: true,
          punchOutAt: true,
          reason: true,
          reviewNote: true,
          before: true,
          after: true,
          createdAt: true,
          reviewedAt: true,
          employee: { select: { displayName: true, employeeCode: true } },
          requestedBy: { select: { name: true } },
          reviewedBy: { select: { name: true } },
        },
      }),
    ]);
    const items: CorrectionRow[] = rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee.displayName,
      employeeCode: r.employee.employeeCode,
      kind: r.kind,
      status: r.status,
      workDate: r.workDate.toISOString().slice(0, 10),
      punchInAt: r.punchInAt?.toISOString() ?? null,
      punchOutAt: r.punchOutAt?.toISOString() ?? null,
      reason: r.reason,
      requestedBy: r.requestedBy?.name ?? null,
      reviewedBy: r.reviewedBy?.name ?? null,
      reviewNote: r.reviewNote,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
    return { items, total, pending, page, pageSize: 25, canManage: can(actor, "attendance:manage") };
  });
}
