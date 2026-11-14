import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { AppError, notFound } from "@/lib/errors";
import { historyEntrySchema } from "@/features/directory/schema";
import type { HistoryKind } from "@/features/employees/labels";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { emitEvent } from "./outbox";
import { authorize } from "./authorize";

export interface HistoryDraft {
  kind: HistoryKind;
  effectiveDate: Date;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
}

/** Appends automatic timeline entries inside the caller's transaction. */
export async function appendHistory(tx: Tx | Db, employeeId: string, actor: Pick<Actor, "id">, drafts: HistoryDraft[]) {
  if (!drafts.length) return;
  await tx.employmentHistory.createMany({
    data: drafts.map((d) => ({
      employeeId,
      kind: d.kind,
      effectiveDate: d.effectiveDate,
      fromValue: d.fromValue ?? null,
      toValue: d.toValue ?? null,
      note: d.note ?? null,
      manual: false,
      createdById: actor.id === "system" ? null : actor.id,
    })),
  });
}

export interface HistoryRow {
  id: string;
  kind: HistoryKind;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  manual: boolean;
  createdAt: string;
  createdBy: string | null;
}

/** Timeline, newest first. */
export async function listHistory(db: Db, actor: Actor, employeeId: string, ctx: RequestContext): Promise<HistoryRow[]> {
  await authorize(db, actor, "employee:read", ctx, { type: "employee", id: employeeId });
  const rows = await db.employmentHistory.findMany({
    where: { employeeId },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { createdBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
    fromValue: r.fromValue,
    toValue: r.toValue,
    note: r.note,
    manual: r.manual,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy?.name ?? null,
  }));
}

/** Manual entry, e.g. a promotion that happened before the employee was added to the system. */
export async function addHistoryEntry(db: Db, actor: Actor, employeeId: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "employee:update", ctx, { type: "employee", id: employeeId });
  const input = historyEntrySchema.parse(rawInput);
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) throw notFound("Employee");
    const row = await tx.employmentHistory.create({
      data: { employeeId, ...input, manual: true, createdById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { actor, action: "employee.history_added", targetType: "employee", targetId: employeeId, metadata: { kind: input.kind } });
    await emitEvent(tx, "employee.updated", { employeeId });
    return row;
  });
}

/** Only manual entries can be removed; automatic entries are part of the record. */
export async function deleteHistoryEntry(db: Db, actor: Actor, employeeId: string, entryId: string, ctx: RequestContext) {
  await authorize(db, actor, "employee:update", ctx, { type: "employee", id: employeeId });
  await db.$transaction(async (tx) => {
    const entry = await tx.employmentHistory.findFirst({ where: { id: entryId, employeeId }, select: { id: true, manual: true, kind: true } });
    if (!entry) throw notFound("History entry");
    if (!entry.manual) throw new AppError("INVALID_STATE", "Automatic history entries can't be removed");
    await tx.employmentHistory.delete({ where: { id: entryId } });
    await recordAudit(tx, ctx, { actor, action: "employee.history_removed", targetType: "employee", targetId: employeeId, metadata: { kind: entry.kind } });
    await emitEvent(tx, "employee.updated", { employeeId });
  });
  return { removed: true };
}
