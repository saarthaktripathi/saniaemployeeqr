import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { AppError, notFound } from "@/lib/errors";
import { DOCUMENT_MAX_BYTES } from "@/features/directory/schema";
import { taskFileMetaSchema } from "@/features/tasks/schema";
import { can } from "@/server/authorization/permissions";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { safeFileName, sniffDocumentType } from "./documents";
import { emitEvent } from "./outbox";

/**
 * Task attachments: briefs (creator/HR, visible to every assignee) and deliverables (the assignee's
 * own uploads). Same rules as employee documents: type decided by content (PDF/JPEG/PNG/WebP),
 * 5 MB, names sanitised. Bytes live in task_file_blob behind RLS.
 */
export async function uploadTaskFile(db: Db, actor: Actor, target: { taskId: string; assignmentId?: string }, rawMeta: unknown, file: Buffer, ctx: RequestContext) {
  const meta = taskFileMetaSchema.parse(rawMeta);
  await enforceRateLimit(db, "task-file", actor.id, RATE_RULES.documentUpload);
  if (file.length === 0) throw new AppError("VALIDATION", "The file is empty");
  if (file.length > DOCUMENT_MAX_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Files can be at most 5 MB");
  const type = sniffDocumentType(file);
  if (!type) throw new AppError("VALIDATION", "Upload a PDF, JPEG, PNG or WebP file");
  const id = randomUUID();
  return withRls(db, actor, async (tx) => {
    const task = await tx.task.findUnique({ where: { id: target.taskId }, select: { id: true, createdById: true, cancelledAt: true } });
    if (!task) throw notFound("Task");
    if (task.cancelledAt) throw new AppError("INVALID_STATE", "This task was cancelled");
    let kind: "BRIEF" | "DELIVERABLE" = "BRIEF";
    if (target.assignmentId) {
      const a = await tx.taskAssignment.findFirst({ where: { id: target.assignmentId, taskId: task.id }, select: { employeeId: true, status: true } });
      if (!a) throw notFound("Task");
      if (a.employeeId !== actor.employeeId) throw new AppError("FORBIDDEN", "Only the assignee can upload deliverables");
      if (a.status === "APPROVED" || a.status === "CANCELLED") throw new AppError("INVALID_STATE", "This work is already closed");
      kind = "DELIVERABLE";
    } else if (!(can(actor, "task:manage") || task.createdById === actor.id)) {
      throw new AppError("FORBIDDEN", "Only the task's creator or HR can add attachments");
    }
    await tx.taskFile.createMany({
      data: [{ id, taskId: task.id, assignmentId: target.assignmentId ?? null, kind, fileName: safeFileName(meta.fileName, type), contentType: type, size: file.length, storageKey: `db:${id}`, uploadedById: actor.id }],
    });
    await tx.taskFileBlob.createMany({ data: [{ fileId: id, data: new Uint8Array(file) }] });
    await tx.taskHistory.createMany({ data: [{ taskId: task.id, assignmentId: target.assignmentId ?? null, actorId: actor.id, action: kind === "BRIEF" ? "attached" : "uploaded", note: safeFileName(meta.fileName, type) }] });
    await recordAudit(tx, ctx, { actor, action: "task.file_uploaded", targetType: "task", targetId: task.id, metadata: { fileId: id, kind, size: file.length, contentType: type } });
    await emitEvent(tx, "task.changed", { taskId: task.id, scope: "task:read", audience: [actor.id, ...(task.createdById ? [task.createdById] : [])] });
    return { id, kind };
  });
}

/** File bytes, if the caller can see the task (brief) or the assignment (deliverable). */
export async function getTaskFile(db: Db, actor: Actor, taskId: string, fileId: string) {
  return withRls(db, actor, async (tx) => {
    const f = await tx.taskFile.findFirst({ where: { id: fileId, taskId }, select: { fileName: true, contentType: true, blob: { select: { data: true } } } });
    if (!f?.blob) throw notFound("File");
    return { fileName: f.fileName, contentType: f.contentType, data: Buffer.from(f.blob.data) };
  });
}

export async function deleteTaskFile(db: Db, actor: Actor, taskId: string, fileId: string, ctx: RequestContext) {
  await withRls(db, actor, async (tx) => {
    const f = await tx.taskFile.findFirst({ where: { id: fileId, taskId }, select: { id: true, uploadedById: true, kind: true } });
    if (!f) throw notFound("File");
    if (f.uploadedById !== actor.id && !can(actor, "task:manage")) throw new AppError("FORBIDDEN", "You can only remove files you uploaded");
    await tx.taskFile.delete({ where: { id: f.id } });
    await recordAudit(tx, ctx, { actor, action: "task.file_deleted", targetType: "task", targetId: taskId, metadata: { fileId, kind: f.kind } });
  });
}
