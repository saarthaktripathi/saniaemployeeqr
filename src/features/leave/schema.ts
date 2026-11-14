import { z } from "zod";
import { isDateString } from "@/lib/time";

export const LEAVE_STATUSES = ["PENDING", "CLARIFICATION", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  CLARIFICATION: "Clarification requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
export const LEAVE_STATUS_TONES: Record<LeaveStatus, "warning" | "info" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  CLARIFICATION: "info",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export const HALF_DAYS = ["NONE", "FIRST_HALF", "SECOND_HALF"] as const;
export const HALF_DAY_LABELS: Record<(typeof HALF_DAYS)[number], string> = { NONE: "Full day(s)", FIRST_HALF: "First half", SECOND_HALF: "Second half" };

const date = z.string().refine(isDateString, "Use a valid date");

export const leaveApplySchema = z
  .object({
    leaveTypeId: z.string().uuid("Choose a leave type"),
    startDate: date,
    endDate: date,
    halfDay: z.enum(HALF_DAYS).default("NONE"),
    reason: z.string().trim().min(3, "Add a short reason").max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before the start date" });
    if (v.halfDay !== "NONE" && v.startDate !== v.endDate) ctx.addIssue({ code: "custom", path: ["halfDay"], message: "Half days are for a single date" });
  });

export const leaveDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "CLARIFY"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === "APPROVE" || Boolean(v.note), { path: ["note"], message: "Add a note for the employee" });

export const leaveRespondSchema = z.object({ note: z.string().trim().min(3, "Reply to HR's question").max(500) }).strict();

export const leaveTypeSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,6}$/, "1–6 letters"),
    name: z.string().trim().min(2).max(60),
    isPaid: z.boolean().default(true),
    annualQuota: z.union([z.coerce.number().min(0).max(366).multipleOf(0.5), z.null()]).default(null),
    allowHalfDay: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict();

export const leaveTypeUpdateSchema = leaveTypeSchema.partial().strict();

export const leaveListQuerySchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  department: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
