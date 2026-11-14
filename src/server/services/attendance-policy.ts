import "server-only";
import type { AttendancePolicy } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { AppError, notFound } from "@/lib/errors";
import { holidayCreateSchema, policyUpdateSchema } from "@/features/attendance/schema";
import type { PolicyRules } from "@/features/attendance/rules";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";

/** The organisation's attendance policy (the migration creates the row; defaults apply if missing). */
export async function getAttendancePolicy(db: Db | Tx): Promise<AttendancePolicy> {
  const row = await db.attendancePolicy.findUnique({ where: { id: 1 } });
  if (row) return row;
  return db.attendancePolicy.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export function policyRules(p: AttendancePolicy): PolicyRules {
  return {
    timezone: p.timezone,
    shiftStart: p.shiftStart,
    shiftEnd: p.shiftEnd,
    graceMinutes: p.graceMinutes,
    earlyLeaveMinutes: p.earlyLeaveMinutes,
    fullDayMinutes: p.fullDayMinutes,
    halfDayMinutes: p.halfDayMinutes,
    weeklyOffDays: p.weeklyOffDays,
    maxSessionHours: p.maxSessionHours,
  };
}

/** HR administrators and owners (policy:manage) change attendance rules; every change is audited. */
export async function updateAttendancePolicy(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "policy:manage", ctx, { type: "attendance_policy", id: "1" });
  const input = policyUpdateSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const before = await getAttendancePolicy(tx);
    const full = input.fullDayMinutes ?? before.fullDayMinutes;
    const half = input.halfDayMinutes ?? before.halfDayMinutes;
    if (half > full) throw new AppError("VALIDATION", "Half day cannot be longer than a full day", { field: "halfDayMinutes" });
    const after = await tx.attendancePolicy.update({
      where: { id: 1 },
      data: { ...input, ...(input.weeklyOffDays ? { weeklyOffDays: [...new Set(input.weeklyOffDays)].sort() } : {}), updatedById: actor.id },
    });
    const changed = Object.keys(input).filter((k) => JSON.stringify(before[k as keyof AttendancePolicy]) !== JSON.stringify(after[k as keyof AttendancePolicy]));
    await recordAudit(tx, ctx, { actor, action: "attendance.policy_updated", targetType: "attendance_policy", targetId: "1", metadata: { changed } });
    return after;
  });
}

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  companyId: string | null;
  company: string | null;
}

/** Holidays between two dates (inclusive), for every company or one company plus group-wide ones. */
export async function listHolidays(db: Db | Tx, from: string, to: string): Promise<HolidayRow[]> {
  const rows = await db.holiday.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: [{ date: "asc" }, { name: "asc" }],
    select: { id: true, date: true, name: true, companyId: true, company: { select: { name: true } } },
    take: 1000,
  });
  return rows.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name, companyId: h.companyId, company: h.company?.name ?? null }));
}

/** Holiday name for an employee's company on each date (group-wide holidays apply to everyone). */
export function holidayLookup(holidays: HolidayRow[]): (date: string, companyId: string) => string | null {
  const map = new Map<string, string>();
  for (const h of holidays) map.set(`${h.date}|${h.companyId ?? "*"}`, h.name);
  return (date, companyId) => map.get(`${date}|${companyId}`) ?? map.get(`${date}|*`) ?? null;
}

export async function addHoliday(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "policy:manage", ctx, { type: "holiday" });
  const input = holidayCreateSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const dup = await tx.holiday.findFirst({ where: { date: new Date(`${input.date}T00:00:00Z`), companyId: input.companyId ?? null }, select: { id: true } });
    if (dup) throw new AppError("CONFLICT", "There is already a holiday on that date", { field: "date" });
    const h = await tx.holiday.create({
      data: { date: new Date(`${input.date}T00:00:00Z`), name: input.name, companyId: input.companyId ?? null, createdById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { actor, action: "attendance.holiday_added", targetType: "holiday", targetId: h.id, metadata: { date: input.date, name: input.name } });
    return h;
  });
}

export async function deleteHoliday(db: Db, actor: Actor, id: string, ctx: RequestContext) {
  await authorize(db, actor, "policy:manage", ctx, { type: "holiday", id });
  await withRls(db, actor, async (tx) => {
    const h = await tx.holiday.findUnique({ where: { id }, select: { date: true, name: true } });
    if (!h) throw notFound("Holiday");
    await tx.holiday.delete({ where: { id } });
    await recordAudit(tx, ctx, { actor, action: "attendance.holiday_removed", targetType: "holiday", targetId: id, metadata: { date: h.date.toISOString().slice(0, 10), name: h.name } });
  });
}
