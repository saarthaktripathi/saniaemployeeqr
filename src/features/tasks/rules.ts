/** Task status machine (pure, unit tested). Each assignee of a task progresses independently. */
import { OPEN_STATUSES, type TaskStatus, type TaskView } from "./schema";

export type AssigneeAction = "ACCEPT" | "START" | "PROGRESS" | "SUBMIT";
export type ReviewerAction = "APPROVE" | "REJECT" | "CANCEL";

const ASSIGNEE: Record<AssigneeAction, { from: readonly TaskStatus[]; to: TaskStatus | null }> = {
  ACCEPT: { from: ["ASSIGNED"], to: "ACCEPTED" },
  START: { from: ["ASSIGNED", "ACCEPTED", "REJECTED"], to: "IN_PROGRESS" },
  // Progress updates keep the status, except that work starts implicitly.
  PROGRESS: { from: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REJECTED"], to: null },
  SUBMIT: { from: ["ACCEPTED", "IN_PROGRESS", "REJECTED"], to: "SUBMITTED" },
};

const REVIEWER: Record<ReviewerAction, { from: readonly TaskStatus[]; to: TaskStatus }> = {
  APPROVE: { from: ["SUBMITTED"], to: "APPROVED" },
  REJECT: { from: ["SUBMITTED"], to: "REJECTED" },
  CANCEL: { from: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "REJECTED"], to: "CANCELLED" },
};

/** Next status for an assignee action, or null when the action is not allowed from `from`. */
export function assigneeTransition(from: TaskStatus, action: AssigneeAction, progress?: number): TaskStatus | null {
  const rule = ASSIGNEE[action];
  if (!rule.from.includes(from)) return null;
  if (rule.to) return rule.to;
  return (progress ?? 0) > 0 && from !== "IN_PROGRESS" ? "IN_PROGRESS" : from;
}

export function reviewerTransition(from: TaskStatus, action: ReviewerAction): TaskStatus | null {
  const rule = REVIEWER[action];
  return rule.from.includes(from) ? rule.to : null;
}

/** Overdue: still open after the due date (local calendar day of the organisation). */
export function isOverdue(status: TaskStatus, dueDate: string | null, today: string): boolean {
  return Boolean(dueDate) && dueDate! < today && OPEN_STATUSES.includes(status);
}

/** Due within the next `days` days (including today), still open. */
export function isDueSoon(status: TaskStatus, dueDate: string | null, today: string, tomorrow: string): boolean {
  return Boolean(dueDate) && dueDate! >= today && dueDate! <= tomorrow && OPEN_STATUSES.includes(status);
}

export function matchesView(view: TaskView, status: TaskStatus, overdue: boolean): boolean {
  switch (view) {
    case "pending":
      return status === "ASSIGNED" || status === "ACCEPTED";
    case "in_progress":
      return status === "IN_PROGRESS" || status === "REJECTED";
    case "submitted":
      return status === "SUBMITTED";
    case "completed":
      return status === "APPROVED";
    case "overdue":
      return overdue;
    default:
      return true;
  }
}
