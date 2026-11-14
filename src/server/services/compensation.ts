import "server-only";
import type { Db } from "@/server/db/client";
import { AppError, notFound } from "@/lib/errors";
import { compensationCreateSchema } from "@/features/directory/schema";
import { utcToday } from "@/features/employees/rules";
import type { CompensationType, PayFrequency } from "@/features/employees/labels";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./authorize";

export interface CompensationRow {
  id: string;
  type: CompensationType;
  /** Decimal as a string (no floating-point rounding). */
  amount: string;
  currency: string;
  frequency: PayFrequency;
  effectiveFrom: string;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Compensation revisions for one employee (restricted: compensation:read). Every view is
 * audited as a security event; amounts never appear in the audit log, events, exports or
 * public pages. `currentId` is the latest revision already in effect.
 */
export async function listCompensation(db: Db, actor: Actor, employeeId: string, ctx: RequestContext) {
  await authorize(db, actor, "compensation:read", ctx, { type: "employee", id: employeeId });
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw notFound("Employee");
  const rows = await db.employeeCompensation.findMany({
    where: { employeeId },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });
  await recordAudit(db, ctx, { actor, action: "compensation.viewed", targetType: "employee", targetId: employeeId });
  const today = utcToday();
  const current = rows.find((r) => r.effectiveFrom <= today) ?? null;
  return {
    currentId: current?.id ?? null,
    rows: rows.map(
      (r): CompensationRow => ({
        id: r.id,
        type: r.type,
        amount: r.amount.toFixed(2),
        currency: r.currency,
        frequency: r.frequency,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        createdBy: r.createdBy?.name ?? null,
      }),
    ),
  };
}

/** Adds a revision (raise, stipend change, new contract rate). History is kept. */
export async function addCompensation(db: Db, actor: Actor, employeeId: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "compensation:manage", ctx, { type: "employee", id: employeeId });
  const input = compensationCreateSchema.parse(rawInput);
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, archivedAt: true } });
    if (!employee) throw notFound("Employee");
    if (employee.archivedAt) throw new AppError("INVALID_STATE", "Archived employees can't be changed. Unarchive first.");
    const row = await tx.employeeCompensation.create({
      data: { employeeId, ...input, createdById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      actor,
      action: "compensation.added",
      targetType: "employee",
      targetId: employeeId,
      metadata: { type: input.type, frequency: input.frequency, effectiveFrom: input.effectiveFrom.toISOString().slice(0, 10) },
    });
    await emitEvent(tx, "employee.updated", { employeeId, scope: "compensation:read" });
    return row;
  });
}

/** Removes a revision entered by mistake. */
export async function deleteCompensation(db: Db, actor: Actor, employeeId: string, entryId: string, ctx: RequestContext) {
  await authorize(db, actor, "compensation:manage", ctx, { type: "employee", id: employeeId });
  await db.$transaction(async (tx) => {
    const row = await tx.employeeCompensation.findFirst({ where: { id: entryId, employeeId }, select: { id: true, type: true } });
    if (!row) throw notFound("Compensation entry");
    await tx.employeeCompensation.delete({ where: { id: entryId } });
    await recordAudit(tx, ctx, { actor, action: "compensation.removed", targetType: "employee", targetId: employeeId, metadata: { type: row.type } });
    await emitEvent(tx, "employee.updated", { employeeId, scope: "compensation:read" });
  });
  return { removed: true };
}
