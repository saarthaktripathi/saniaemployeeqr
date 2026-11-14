import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { addDays, formatLongDate, localDate } from "@/lib/time";
import {
  assignmentActionSchema,
  assignmentReviewSchema,
  commentSchema,
  formatTaskNumber,
  OPEN_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  taskCancelSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  type TaskStatus,
  type TaskView,
} from "@/features/tasks/schema";
import { assigneeTransition, isDueSoon, isOverdue, matchesView, reviewerTransition } from "@/features/tasks/rules";
import { can } from "@/server/authorization/permissions";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";
import { emitEvent } from "./outbox";
import { notify, usersWithPermission } from "./notifications";
import { teamMemberIds } from "./team";
import { getAttendancePolicy } from "./attendance-policy";
import { requireEmployee } from "./attendance";

const day = (d: string | undefined | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** Organisation "today" (task due dates are calendar days in the organisation time zone). */
async function orgToday(db: Db | Tx): Promise<string> {
  return localDate(new Date(), (await getAttendancePolicy(db)).timezone);
}

/** Active login ids for employee records (notification recipients). */
async function userIdsFor(db: Db | Tx, employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const users = await db.user.findMany({ where: { employeeId: { in: employeeIds }, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Who may review/cancel/edit a task: its creator, or HR with task:manage. */
async function canManageTask(db: Db, actor: Actor, taskId: string): Promise<{ allowed: boolean; createdById: string | null } | null> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { createdById: true } });
  if (!t) return null;
  return { allowed: can(actor, "task:manage") || (t.createdById !== null && t.createdById === actor.id), createdById: t.createdById };
}

async function requireTaskManager(db: Db, actor: Actor, taskId: string, ctx: RequestContext) {
  const m = await canManageTask(db, actor, taskId);
  if (!m) throw notFound("Task");
  if (!m.allowed) {
    await authorize(db, actor, "task:manage", ctx, { type: "task", id: taskId });
    throw forbidden();
  }
  return m;
}

/**
 * Creates a task and its assignments. HR (task:manage) may assign anyone or a whole department;
 * team managers may assign only people in their reporting tree.
 */
export async function createTask(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  const manage = can(actor, "task:manage");
  if (!manage && actor.role !== "TEAM_MANAGER") await authorize(db, actor, "task:manage", ctx, { type: "task" });
  const input = taskCreateSchema.parse(raw);
  if (!manage && input.target === "DEPARTMENT") throw new AppError("FORBIDDEN", "Only HR can assign a task to a whole department");
  await enforceRateLimit(db, "task-create", actor.id, RATE_RULES.employeeCreate);

  let employeeIds = [...new Set(input.employeeIds)];
  if (input.target === "DEPARTMENT") {
    const rows = await db.employee.findMany({
      where: { department: { equals: input.department!, mode: "insensitive" }, archivedAt: null, employmentStatus: "ACTIVE" },
      select: { id: true },
      take: 500,
    });
    employeeIds = rows.map((r) => r.id);
    if (employeeIds.length === 0) throw new AppError("VALIDATION", "No active employees in that department", { field: "department" });
  }
  const valid = await db.employee.count({ where: { id: { in: employeeIds }, archivedAt: null, employmentStatus: "ACTIVE" } });
  if (valid !== employeeIds.length) throw new AppError("VALIDATION", "Choose active employees only", { field: "employeeIds" });
  if (!manage) {
    const team = new Set(await teamMemberIds(db, actor.employeeId!));
    if (employeeIds.some((id) => !team.has(id))) {
      await recordAudit(db, ctx, { actor, action: "authz.denied", targetType: "task", outcome: "DENIED", metadata: { reason: "assignee outside team" } });
      throw new AppError("FORBIDDEN", "You can only assign tasks to people who report to you");
    }
  }
  const recipients = await userIdsFor(db, employeeIds);
  const id = randomUUID();
  return withRls(db, actor, async (tx) => {
    // createMany (no RETURNING): the row becomes visible to RLS checks only after this statement.
    await tx.task.createMany({
      data: [
        {
          id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          target: input.target,
          department: input.target === "DEPARTMENT" ? input.department! : null,
          startDate: day(input.startDate),
          dueDate: day(input.dueDate),
          createdById: actor.id,
        },
      ],
    });
    await tx.taskAssignment.createMany({ data: employeeIds.map((employeeId) => ({ taskId: id, employeeId })) });
    await tx.taskHistory.createMany({ data: [{ taskId: id, actorId: actor.id, action: "created", toStatus: "ASSIGNED", note: `Assigned to ${employeeIds.length} ${employeeIds.length === 1 ? "person" : "people"}` }] });
    const task = await tx.task.findUniqueOrThrow({ where: { id }, select: { id: true, number: true } });
    await recordAudit(tx, ctx, { actor, action: "task.created", targetType: "task", targetId: id, metadata: { number: task.number, target: input.target, priority: input.priority, assignees: employeeIds.length } });
    await notify(tx, recipients, {
      type: "task.assigned",
      title: `New task: ${input.title}`,
      body: `${PRIORITY_LABELS[input.priority]} priority${input.dueDate ? ` · due ${formatLongDate(input.dueDate)}` : ""}`,
      link: `/me/tasks/${id}`,
      entityType: "task",
      entityId: id,
    });
    await emitEvent(tx, "task.changed", { taskId: id, scope: "task:read", audience: [...recipients, actor.id] });
    return { id, number: task.number, code: formatTaskNumber(task.number), assignees: employeeIds.length };
  });
}

export async function updateTask(db: Db, actor: Actor, taskId: string, raw: unknown, ctx: RequestContext) {
  await requireTaskManager(db, actor, taskId, ctx);
  const input = taskUpdateSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const before = await tx.task.findUnique({ where: { id: taskId }, select: { title: true, description: true, priority: true, startDate: true, dueDate: true, cancelledAt: true, version: true, assignments: { select: { employeeId: true } } } });
    if (!before) throw notFound("Task");
    if (before.cancelledAt) throw new AppError("INVALID_STATE", "This task was cancelled");
    const startDate = input.startDate === undefined ? before.startDate : day(input.startDate);
    const dueDate = input.dueDate === undefined ? before.dueDate : day(input.dueDate);
    if (startDate && dueDate && dueDate < startDate) throw new AppError("VALIDATION", "Due date is before the start date", { field: "dueDate" });
    const res = await tx.task.updateMany({
      where: { id: taskId, version: input.version },
      data: { title: input.title, description: input.description, priority: input.priority, startDate, dueDate, version: { increment: 1 } },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "Someone else changed this task. Reload and try again.");
    const changed = (["title", "description", "priority"] as const).filter((k) => input[k] !== undefined && input[k] !== before[k]);
    if (iso(startDate) !== iso(before.startDate)) changed.push("startDate" as never);
    if (iso(dueDate) !== iso(before.dueDate)) changed.push("dueDate" as never);
    await tx.taskHistory.createMany({ data: [{ taskId, actorId: actor.id, action: "edited", note: changed.join(", ") || "no changes" }] });
    await recordAudit(tx, ctx, { actor, action: "task.updated", targetType: "task", targetId: taskId, metadata: { changed } });
    const recipients = await userIdsFor(tx, before.assignments.map((a) => a.employeeId));
    if (changed.length) {
      await notify(tx, recipients, {
        type: "task.updated",
        title: `Task updated: ${input.title ?? before.title}`,
        body: (changed as string[]).includes("dueDate") ? `New due date: ${dueDate ? formatLongDate(iso(dueDate)!) : "none"}` : `Changed: ${changed.join(", ")}`,
        link: `/me/tasks/${taskId}`,
        entityType: "task",
        entityId: taskId,
      });
    }
    await emitEvent(tx, "task.changed", { taskId, scope: "task:read", audience: [...recipients, actor.id] });
    return { ok: true };
  });
}

export async function cancelTask(db: Db, actor: Actor, taskId: string, raw: unknown, ctx: RequestContext) {
  await requireTaskManager(db, actor, taskId, ctx);
  const input = taskCancelSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const t = await tx.task.findUnique({ where: { id: taskId }, select: { title: true, cancelledAt: true, assignments: { select: { employeeId: true } } } });
    if (!t) throw notFound("Task");
    if (t.cancelledAt) throw new AppError("INVALID_STATE", "This task is already cancelled");
    await tx.task.update({ where: { id: taskId }, data: { cancelledAt: new Date(), cancelReason: input.reason, version: { increment: 1 } } });
    const res = await tx.taskAssignment.updateMany({ where: { taskId, status: { notIn: ["APPROVED", "CANCELLED"] } }, data: { status: "CANCELLED", version: { increment: 1 } } });
    await tx.taskHistory.createMany({ data: [{ taskId, actorId: actor.id, action: "cancelled", toStatus: "CANCELLED", note: input.reason }] });
    await recordAudit(tx, ctx, { actor, action: "task.cancelled", targetType: "task", targetId: taskId, metadata: { assignmentsCancelled: res.count } });
    const recipients = await userIdsFor(tx, t.assignments.map((a) => a.employeeId));
    await notify(tx, recipients, { type: "task.cancelled", title: `Task cancelled: ${t.title}`, body: input.reason, link: `/me/tasks/${taskId}`, entityType: "task", entityId: taskId });
    await emitEvent(tx, "task.changed", { taskId, scope: "task:read", audience: [...recipients, actor.id] });
    return { ok: true };
  });
}

/** Assignee actions: accept, start, update progress, submit for review. */
export async function actOnAssignment(db: Db, actor: Actor, assignmentId: string, raw: unknown, ctx: RequestContext) {
  const employeeId = requireEmployee(actor);
  const input = assignmentActionSchema.parse(raw);
  await enforceRateLimit(db, "self-service", actor.id, RATE_RULES.selfService);
  return withRls(db, actor, async (tx) => {
    const a = await tx.taskAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, status: true, version: true, progress: true, employeeId: true, startedAt: true, employee: { select: { displayName: true } }, task: { select: { id: true, title: true, createdById: true, cancelledAt: true } } },
    });
    if (!a || a.employeeId !== employeeId) throw notFound("Task");
    if (a.task.cancelledAt) throw new AppError("INVALID_STATE", "This task was cancelled");
    const next = assigneeTransition(a.status, input.action, input.progress);
    if (!next) throw new AppError("INVALID_STATE", `You can't ${input.action.toLowerCase()} a task that is ${STATUS_LABELS[a.status].toLowerCase()}`);
    const now = new Date();
    const progress = input.action === "SUBMIT" ? Math.max(a.progress, input.progress ?? 100) : (input.progress ?? a.progress);
    const res = await tx.taskAssignment.updateMany({
      where: { id: a.id, version: a.version },
      data: {
        status: next,
        progress,
        ...(input.action === "ACCEPT" ? { acceptedAt: now } : {}),
        ...(next === "IN_PROGRESS" && !a.startedAt ? { startedAt: now } : {}),
        ...(input.action === "SUBMIT" ? { submittedAt: now } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "This task changed meanwhile. Refresh and try again.");
    await tx.taskHistory.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, actorId: actor.id, action: input.action.toLowerCase(), fromStatus: a.status, toStatus: next, progress, note: input.note ?? null }] });
    if (input.note) await tx.taskComment.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, authorId: actor.id, body: input.note }] });
    if (next !== a.status) {
      await recordAudit(tx, ctx, { actor, action: "task.status_changed", targetType: "task", targetId: a.task.id, metadata: { assignmentId: a.id, from: a.status, to: next } });
    }
    const reviewers = input.action === "SUBMIT" ? (a.task.createdById ? [a.task.createdById] : await usersWithPermission(tx, "task:manage")) : [];
    if (reviewers.length) {
      await notify(tx, reviewers, {
        type: "task.submitted",
        title: `${a.employee.displayName} submitted “${a.task.title}” for review`,
        body: input.note ?? null,
        link: `/tasks/${a.task.id}`,
        entityType: "task_assignment",
        entityId: a.id,
      });
    }
    await emitEvent(tx, "task.changed", { taskId: a.task.id, scope: "task:read", audience: [actor.id, ...(a.task.createdById ? [a.task.createdById] : [])] });
    return { status: next, progress };
  });
}

/** Creator or HR (task:manage): approve or reject a submission (rejection sends it back for rework). */
export async function reviewAssignment(db: Db, actor: Actor, assignmentId: string, raw: unknown, ctx: RequestContext) {
  const input = assignmentReviewSchema.parse(raw);
  const ref = await db.taskAssignment.findUnique({ where: { id: assignmentId }, select: { taskId: true, employeeId: true } });
  if (!ref) throw notFound("Task");
  await requireTaskManager(db, actor, ref.taskId, ctx);
  const recipients = await userIdsFor(db, [ref.employeeId]);
  return withRls(db, actor, async (tx) => {
    const a = await tx.taskAssignment.findUnique({ where: { id: assignmentId }, select: { id: true, status: true, version: true, task: { select: { id: true, title: true } } } });
    if (!a) throw notFound("Task");
    const next = reviewerTransition(a.status, input.decision);
    if (!next) throw new AppError("INVALID_STATE", "Only submitted work can be reviewed");
    const res = await tx.taskAssignment.updateMany({
      where: { id: a.id, version: a.version },
      data: { status: next, reviewedAt: new Date(), reviewedById: actor.id, reviewNote: input.note ?? null, ...(next === "APPROVED" ? { progress: 100 } : {}), version: { increment: 1 } },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "This task changed meanwhile. Refresh and try again.");
    await tx.taskHistory.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, actorId: actor.id, action: input.decision === "APPROVE" ? "approved" : "rejected", fromStatus: a.status, toStatus: next, note: input.note ?? null }] });
    if (input.note) await tx.taskComment.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, authorId: actor.id, body: input.note }] });
    await recordAudit(tx, ctx, { actor, action: input.decision === "APPROVE" ? "task.approved" : "task.rejected", targetType: "task", targetId: a.task.id, metadata: { assignmentId: a.id } });
    await notify(tx, recipients, {
      type: input.decision === "APPROVE" ? "task.approved" : "task.rejected",
      title: input.decision === "APPROVE" ? `Approved: ${a.task.title}` : `Changes requested: ${a.task.title}`,
      body: input.note ?? null,
      link: `/me/tasks/${a.task.id}`,
      entityType: "task_assignment",
      entityId: a.id,
    });
    await emitEvent(tx, "task.changed", { taskId: a.task.id, scope: "task:read", audience: [...recipients, actor.id] });
    return { status: next };
  });
}

/** Comment on one assignee's thread (assignee, task creator, HR; RLS decides visibility). */
export async function addTaskComment(db: Db, actor: Actor, assignmentId: string, raw: unknown) {
  const input = commentSchema.parse(raw);
  await enforceRateLimit(db, "self-service", actor.id, RATE_RULES.selfService);
  const ref = await db.taskAssignment.findUnique({ where: { id: assignmentId }, select: { employeeId: true, task: { select: { createdById: true } } } });
  const assigneeUsers = ref ? await userIdsFor(db, [ref.employeeId]) : [];
  return withRls(db, actor, async (tx) => {
    const a = await tx.taskAssignment.findUnique({ where: { id: assignmentId }, select: { id: true, employeeId: true, task: { select: { id: true, title: true, createdById: true } } } });
    if (!a) throw notFound("Task");
    await tx.taskComment.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, authorId: actor.id, body: input.body }] });
    await tx.taskHistory.createMany({ data: [{ taskId: a.task.id, assignmentId: a.id, actorId: actor.id, action: "commented" }] });
    const fromAssignee = a.employeeId === actor.employeeId;
    const recipients = fromAssignee ? (a.task.createdById ? [a.task.createdById] : []) : assigneeUsers;
    await notify(
      tx,
      recipients.filter((r) => r !== actor.id),
      {
        type: "task.comment",
        title: `${actor.name} commented on “${a.task.title}”`,
        body: input.body.slice(0, 200),
        link: fromAssignee ? `/tasks/${a.task.id}` : `/me/tasks/${a.task.id}`,
        entityType: "task_assignment",
        entityId: a.id,
      },
    );
    await emitEvent(tx, "task.changed", { taskId: a.task.id, scope: "task:read", audience: [...recipients, actor.id] });
    return { ok: true };
  });
}

export interface MyTaskItem {
  assignmentId: string;
  taskId: string;
  code: string;
  title: string;
  priority: keyof typeof PRIORITY_LABELS;
  status: TaskStatus;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  overdue: boolean;
  dueSoon: boolean;
  assignedBy: string | null;
  updatedAt: string;
}

/** The signed-in employee's task board (list / kanban / calendar all use this). */
export async function getMyTasks(db: Db, actor: Actor, view: TaskView = "all") {
  const employeeId = requireEmployee(actor);
  const today = await orgToday(db);
  const tomorrow = addDays(today, 1);
  return withRls(db, actor, async (tx) => {
    const rows = await tx.taskAssignment.findMany({
      where: { employeeId },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      select: {
        id: true,
        status: true,
        progress: true,
        updatedAt: true,
        task: { select: { id: true, number: true, title: true, priority: true, startDate: true, dueDate: true, createdBy: { select: { name: true } } } },
      },
    });
    const items: MyTaskItem[] = rows.map((r) => {
      const due = iso(r.task.dueDate);
      return {
        assignmentId: r.id,
        taskId: r.task.id,
        code: formatTaskNumber(r.task.number),
        title: r.task.title,
        priority: r.task.priority,
        status: r.status,
        progress: r.progress,
        startDate: iso(r.task.startDate),
        dueDate: due,
        overdue: isOverdue(r.status, due, today),
        dueSoon: isDueSoon(r.status, due, today, tomorrow),
        assignedBy: r.task.createdBy?.name ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
    const counts = Object.fromEntries((["all", "pending", "in_progress", "submitted", "completed", "overdue"] as TaskView[]).map((v) => [v, items.filter((i) => matchesView(v, i.status, i.overdue) && (v !== "all" || i.status !== "CANCELLED")).length]));
    return { today, items: items.filter((i) => matchesView(view, i.status, i.overdue)), counts: counts as Record<TaskView, number> };
  });
}

export async function getMyTaskStats(db: Db, actor: Actor) {
  const { items } = await getMyTasks(db, actor, "all");
  return {
    pending: items.filter((i) => OPEN_STATUSES.includes(i.status)).length,
    completed: items.filter((i) => i.status === "APPROVED").length,
    overdue: items.filter((i) => i.overdue).length,
  };
}

/** Full task detail as the caller is allowed to see it (assignees see only their own thread). */
export async function getTaskDetail(db: Db, actor: Actor, taskId: string) {
  const today = await orgToday(db);
  return withRls(db, actor, async (tx) => {
    const t = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        target: true,
        department: true,
        startDate: true,
        dueDate: true,
        cancelledAt: true,
        cancelReason: true,
        version: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { name: true } },
        files: { where: { kind: "BRIEF" }, select: { id: true, fileName: true, contentType: true, size: true, createdAt: true } },
        history: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, assignmentId: true, actorId: true, action: true, fromStatus: true, toStatus: true, progress: true, note: true, createdAt: true } },
      },
    });
    if (!t) throw notFound("Task");
    const assignments = await tx.taskAssignment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: {
        id: true,
        status: true,
        progress: true,
        submittedAt: true,
        reviewedAt: true,
        reviewNote: true,
        employeeId: true,
        employee: { select: { displayName: true, employeeCode: true, department: true, jobTitle: true, photoKey: true, photoUpdatedAt: true } },
        reviewedBy: { select: { name: true } },
        comments: { orderBy: { createdAt: "asc" }, take: 200, select: { id: true, body: true, createdAt: true, authorId: true, author: { select: { name: true } } } },
        files: { select: { id: true, fileName: true, contentType: true, size: true, createdAt: true, uploadedById: true } },
      },
    });
    const actorIds = [...new Set(t.history.map((h) => h.actorId).filter((x): x is string => Boolean(x)))];
    const names = new Map((await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const visibleAssignments = new Set(assignments.map((a) => a.id));
    const due = iso(t.dueDate);
    const canManage = can(actor, "task:manage") || t.createdById === actor.id;
    return {
      id: t.id,
      code: formatTaskNumber(t.number),
      title: t.title,
      description: t.description,
      priority: t.priority,
      target: t.target,
      department: t.department,
      startDate: iso(t.startDate),
      dueDate: due,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      cancelReason: t.cancelReason,
      version: t.version,
      createdAt: t.createdAt.toISOString(),
      createdBy: t.createdBy?.name ?? "Former user",
      today,
      canManage,
      myAssignmentId: assignments.find((a) => a.employeeId === actor.employeeId)?.id ?? null,
      briefFiles: t.files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
      assignments: assignments.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        name: a.employee.displayName,
        employeeCode: a.employee.employeeCode,
        department: a.employee.department,
        designation: a.employee.jobTitle,
        photoUpdatedAt: a.employee.photoKey ? (a.employee.photoUpdatedAt?.toISOString() ?? null) : null,
        status: a.status,
        progress: a.progress,
        overdue: isOverdue(a.status, due, today),
        submittedAt: a.submittedAt?.toISOString() ?? null,
        reviewedAt: a.reviewedAt?.toISOString() ?? null,
        reviewNote: a.reviewNote,
        reviewedBy: a.reviewedBy?.name ?? null,
        comments: a.comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: c.author?.name ?? "Former user", mine: c.authorId === actor.id })),
        files: a.files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), mine: f.uploadedById === actor.id })),
      })),
      history: t.history
        .filter((h) => !h.assignmentId || visibleAssignments.has(h.assignmentId))
        .map((h) => ({ ...h, id: h.id.toString(), actor: h.actorId ? (names.get(h.actorId) ?? "Former user") : "System", createdAt: h.createdAt.toISOString() })),
    };
  });
}
export type TaskDetail = Awaited<ReturnType<typeof getTaskDetail>>;

export interface TaskListItem {
  id: string;
  code: string;
  title: string;
  priority: keyof typeof PRIORITY_LABELS;
  target: string;
  department: string | null;
  dueDate: string | null;
  createdAt: string;
  createdBy: string | null;
  cancelled: boolean;
  assignees: { name: string; status: TaskStatus; progress: number }[];
  counts: Record<TaskStatus, number>;
  overdue: number;
  progress: number;
}

/** Task management list (HR: everything; team managers: tasks they created or assigned to their team). */
export async function listTasks(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  if (!can(actor, "task:read") && actor.role !== "TEAM_MANAGER") await authorize(db, actor, "task:read", ctx, { type: "task" });
  const q = taskListQuerySchema.parse(raw ?? {});
  const today = await orgToday(db);
  const open = OPEN_STATUSES as TaskStatus[];
  const viewWhere: Record<TaskView, Prisma.TaskWhereInput> = {
    all: {},
    pending: { assignments: { some: { status: { in: ["ASSIGNED", "ACCEPTED"] } } } },
    in_progress: { assignments: { some: { status: { in: ["IN_PROGRESS", "REJECTED"] } } } },
    submitted: { assignments: { some: { status: "SUBMITTED" } } },
    completed: { assignments: { some: { status: "APPROVED" } } },
    overdue: { dueDate: { lt: day(today)! }, assignments: { some: { status: { in: open } } } },
  };
  const numberQuery = q.q && /^(tsk-?)?\d{1,7}$/i.test(q.q) ? Number(q.q.replace(/\D/g, "")) : null;
  const where: Prisma.TaskWhereInput = {
    AND: [
      viewWhere[q.view ?? "all"],
      q.priority ? { priority: q.priority } : {},
      q.mine ? { createdById: actor.id } : {},
      q.department ? { OR: [{ department: { equals: q.department, mode: "insensitive" } }, { assignments: { some: { employee: { department: { equals: q.department, mode: "insensitive" } } } } }] } : {},
      q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, ...(numberQuery ? [{ number: numberQuery }] : [])] } : {},
    ],
  };
  return withRls(db, actor, async (tx) => {
    const [total, rows, submitted, overdue, openCount] = await Promise.all([
      tx.task.count({ where }),
      tx.task.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (q.page - 1) * 20,
        take: 20,
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          target: true,
          department: true,
          dueDate: true,
          createdAt: true,
          cancelledAt: true,
          createdBy: { select: { name: true } },
          assignments: { select: { status: true, progress: true, employee: { select: { displayName: true } } }, take: 200 },
        },
      }),
      tx.taskAssignment.count({ where: { status: "SUBMITTED" } }),
      tx.taskAssignment.count({ where: { status: { in: open }, task: { dueDate: { lt: day(today)! } } } }),
      tx.taskAssignment.count({ where: { status: { in: open } } }),
    ]);
    const items: TaskListItem[] = rows.map((t) => {
      const counts = Object.fromEntries(["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"].map((s) => [s, 0])) as Record<TaskStatus, number>;
      for (const a of t.assignments) counts[a.status]++;
      const live = t.assignments.filter((a) => a.status !== "CANCELLED");
      const due = iso(t.dueDate);
      return {
        id: t.id,
        code: formatTaskNumber(t.number),
        title: t.title,
        priority: t.priority,
        target: t.target,
        department: t.department,
        dueDate: due,
        createdAt: t.createdAt.toISOString(),
        createdBy: t.createdBy?.name ?? null,
        cancelled: Boolean(t.cancelledAt),
        assignees: t.assignments.slice(0, 5).map((a) => ({ name: a.employee.displayName, status: a.status, progress: a.progress })),
        counts,
        overdue: t.assignments.filter((a) => isOverdue(a.status, due, today)).length,
        progress: live.length ? Math.round(live.reduce((s, a) => s + a.progress, 0) / live.length) : 0,
      };
    });
    return { today, items, total, page: q.page, pageSize: 20, kpis: { open: openCount, submitted, overdue }, canManageAll: can(actor, "task:manage") };
  });
}

/**
 * Deadline reminders (idempotent through notification dedupe keys): due today/tomorrow to the
 * assignee, overdue to assignee and assigner, and overdue HIGH/CRITICAL work to HR task managers.
 * Runs as the system (no RLS role) from the opportunistic sweep or the maintenance command.
 */
export async function sweepTaskDeadlines(db: Db | Tx): Promise<number> {
  const today = await orgToday(db);
  const tomorrow = addDays(today, 1);
  const rows = await db.taskAssignment.findMany({
    where: { status: { in: OPEN_STATUSES as TaskStatus[] }, task: { cancelledAt: null, dueDate: { not: null, lte: day(tomorrow)! } } },
    select: { id: true, status: true, employeeId: true, employee: { select: { displayName: true } }, task: { select: { id: true, title: true, priority: true, dueDate: true, createdById: true } } },
    take: 2000,
  });
  if (rows.length === 0) return 0;
  const users = await db.user.findMany({ where: { employeeId: { in: [...new Set(rows.map((r) => r.employeeId))] }, isActive: true }, select: { id: true, employeeId: true } });
  const userOf = new Map(users.map((u) => [u.employeeId!, u.id]));
  const hr = await usersWithPermission(db, "task:manage");
  let sent = 0;
  for (const r of rows) {
    const due = iso(r.task.dueDate)!;
    const assignee = userOf.get(r.employeeId);
    if (due >= today) {
      if (assignee) {
        await notify(db, [assignee], { type: "task.due_soon", title: `Due ${due === today ? "today" : "tomorrow"}: ${r.task.title}`, link: `/me/tasks/${r.task.id}`, entityType: "task", entityId: r.task.id, dedupeKey: `task-due:${r.id}:${due}` });
        sent++;
      }
      continue;
    }
    const recipients = [assignee, r.task.createdById].filter((x): x is string => Boolean(x));
    const overdue = { type: "task.overdue", title: `Overdue: ${r.task.title}`, body: `${r.employee.displayName} · was due ${formatLongDate(due)}`, entityType: "task", entityId: r.task.id, dedupeKey: `task-overdue:${r.id}:${due}` };
    if (assignee) await notify(db, [assignee], { ...overdue, link: `/me/tasks/${r.task.id}` });
    if (r.task.createdById && r.task.createdById !== assignee) await notify(db, [r.task.createdById], { ...overdue, link: `/tasks/${r.task.id}` });
    if (r.task.priority === "HIGH" || r.task.priority === "CRITICAL") {
      await notify(db, hr.filter((id) => !recipients.includes(id)), {
        type: "task.deadline_missed",
        title: `Missed deadline (${PRIORITY_LABELS[r.task.priority]}): ${r.task.title}`,
        body: `${r.employee.displayName} · was due ${formatLongDate(due)}`,
        link: `/tasks/${r.task.id}`,
        entityType: "task",
        entityId: r.task.id,
        dedupeKey: `task-missed:${r.id}:${due}`,
      });
    }
    sent++;
  }
  return sent;
}
