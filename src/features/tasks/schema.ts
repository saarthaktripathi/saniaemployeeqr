import { z } from "zod";
import { isDateString } from "@/lib/time";

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
export const PRIORITY_TONES: Record<TaskPriority, "neutral" | "info" | "orange" | "danger"> = { LOW: "neutral", MEDIUM: "info", HIGH: "orange", CRITICAL: "danger" };

export const TASK_STATUSES = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Needs rework",
  CANCELLED: "Cancelled",
};
export const STATUS_TONES: Record<TaskStatus, "neutral" | "info" | "violet" | "warning" | "success" | "danger" | "teal"> = {
  ASSIGNED: "neutral",
  ACCEPTED: "info",
  IN_PROGRESS: "violet",
  SUBMITTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export const TASK_TARGETS = ["INDIVIDUAL", "MULTIPLE", "DEPARTMENT"] as const;

/** Work not yet finished by the assignee (counts towards "pending" and can become overdue). */
export const OPEN_STATUSES: readonly TaskStatus[] = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REJECTED"];

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isDateString(v), "Use a valid date");

export const taskCreateSchema = z
  .object({
    title: z.string().trim().min(3, "Give the task a title").max(160),
    description: z.string().trim().max(5000).default(""),
    priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
    target: z.enum(TASK_TARGETS).default("INDIVIDUAL"),
    employeeIds: z.array(z.string().uuid()).max(200).default([]),
    department: z.string().trim().max(120).optional(),
    startDate: optionalDate,
    dueDate: optionalDate,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.target === "DEPARTMENT" && !v.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Choose a department" });
    if (v.target === "INDIVIDUAL" && v.employeeIds.length !== 1) ctx.addIssue({ code: "custom", path: ["employeeIds"], message: "Choose one employee" });
    if (v.target === "MULTIPLE" && v.employeeIds.length < 1) ctx.addIssue({ code: "custom", path: ["employeeIds"], message: "Choose at least one employee" });
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date is before the start date" });
  });

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().max(5000).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    startDate: optionalDate.nullable(),
    dueDate: optionalDate.nullable(),
    version: z.number().int().min(1),
  })
  .strict();

export const taskCancelSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) }).strict();

export const ASSIGNEE_ACTIONS = ["ACCEPT", "START", "PROGRESS", "SUBMIT"] as const;
export const assignmentActionSchema = z
  .object({
    action: z.enum(ASSIGNEE_ACTIONS),
    progress: z.coerce.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.action !== "PROGRESS" || v.progress !== undefined, { path: ["progress"], message: "Enter progress" });

export const assignmentReviewSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(1000).optional() })
  .strict()
  .refine((v) => v.decision === "APPROVE" || Boolean(v.note), { path: ["note"], message: "Tell the employee what to change" });

export const commentSchema = z.object({ body: z.string().trim().min(1, "Write a comment").max(2000) }).strict();

export const TASK_VIEWS = ["all", "pending", "in_progress", "submitted", "completed", "overdue"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const taskListQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  priority: z.enum(TASK_PRIORITIES).optional().catch(undefined),
  department: z.string().trim().max(120).optional().catch(undefined),
  mine: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

export const taskFileMetaSchema = z.object({ fileName: z.string().trim().min(1).max(200) }).strict();

export const formatTaskNumber = (n: number) => `TSK-${String(n).padStart(5, "0")}`;
