import { z } from "zod";
import { isDateString, isTimeString, isValidTimeZone } from "@/lib/time";

export const LOCATIONS = ["OFFICE", "WORK_FROM_HOME", "CLIENT_VISIT"] as const;
export type AttendanceLocation = (typeof LOCATIONS)[number];
export const LOCATION_LABELS: Record<AttendanceLocation, string> = {
  OFFICE: "Office",
  WORK_FROM_HOME: "Work from home",
  CLIENT_VISIT: "Client visit",
};

export const LOGOUT_POLICIES = ["ALLOW", "WARN", "BLOCK"] as const;
export const LOGOUT_POLICY_LABELS: Record<(typeof LOGOUT_POLICIES)[number], string> = {
  ALLOW: "Allow sign-out (stay punched in)",
  WARN: "Warn and offer to punch out first",
  BLOCK: "Require punch-out before sign-out",
};

const notes = z.string().trim().max(300).optional().transform((v) => (v ? v : undefined));
const date = z.string().refine(isDateString, "Use a valid date (YYYY-MM-DD)");
const time = z.string().refine(isTimeString, "Use HH:MM (24-hour)");

export const punchInSchema = z.object({ location: z.enum(LOCATIONS, { error: "Choose where you are working" }), notes }).strict();
export const punchOutSchema = z.object({ notes }).strict();

export const policyUpdateSchema = z
  .object({
    timezone: z.string().trim().max(64).refine(isValidTimeZone, "Unknown time zone"),
    shiftStart: time,
    shiftEnd: time,
    graceMinutes: z.coerce.number().int().min(0).max(240),
    earlyLeaveMinutes: z.coerce.number().int().min(0).max(240),
    fullDayMinutes: z.coerce.number().int().min(30).max(1440),
    halfDayMinutes: z.coerce.number().int().min(0).max(1440),
    allowMultipleSessions: z.boolean(),
    allowedLocations: z.array(z.enum(LOCATIONS)).min(1, "Allow at least one work location").max(3),
    weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6),
    logoutPolicy: z.enum(LOGOUT_POLICIES),
    maxSessionHours: z.coerce.number().int().min(1).max(48),
    correctionWindowDays: z.coerce.number().int().min(0).max(90),
  })
  .strict()
  .partial()
  .refine((v) => v.halfDayMinutes === undefined || v.fullDayMinutes === undefined || v.halfDayMinutes <= v.fullDayMinutes, {
    path: ["halfDayMinutes"],
    message: "Half day cannot be longer than a full day",
  });

export const holidayCreateSchema = z
  .object({
    date,
    name: z.string().trim().min(1, "Name the holiday").max(80),
    companyId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const CORRECTION_KINDS = ["ADD_SESSION", "CHANGE_TIMES", "CLOSE_SESSION", "VOID_SESSION"] as const;
export const CORRECTION_LABELS: Record<(typeof CORRECTION_KINDS)[number], string> = {
  ADD_SESSION: "Add a missed session",
  CHANGE_TIMES: "Change punch times",
  CLOSE_SESSION: "Add a missed punch-out",
  VOID_SESSION: "Remove a session entered by mistake",
};

/** Times are local "HH:MM" on `workDate` (punchOut may be earlier than punchIn for overnight work). */
export const correctionSchema = z
  .object({
    kind: z.enum(CORRECTION_KINDS),
    sessionId: z.string().uuid().optional(),
    workDate: date,
    punchIn: time.optional(),
    punchOut: time.optional(),
    location: z.enum(LOCATIONS).optional(),
    reason: z.string().trim().min(3, "Explain the correction").max(300),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (field: "sessionId" | "punchIn" | "punchOut", message: string) => {
      if (!v[field]) ctx.addIssue({ code: "custom", path: [field], message });
    };
    if (v.kind !== "ADD_SESSION") need("sessionId", "Choose the session to correct");
    if (v.kind === "ADD_SESSION") {
      need("punchIn", "Enter the punch-in time");
      need("punchOut", "Enter the punch-out time");
    }
    if (v.kind === "CHANGE_TIMES" && !v.punchIn && !v.punchOut) ctx.addIssue({ code: "custom", path: ["punchIn"], message: "Enter a new time" });
    if (v.kind === "CLOSE_SESSION") need("punchOut", "Enter the punch-out time");
  });

/** HR applying a correction directly for an employee. */
export const hrCorrectionSchema = correctionSchema.and(z.object({ employeeId: z.string().uuid() }));

export const correctionReviewSchema = z
  .object({
    decision: z.enum(["APPLY", "REJECT"]),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => v.decision === "APPLY" || Boolean(v.note), { path: ["note"], message: "Give a reason for rejecting" });

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
  .optional()
  .catch(undefined);

export const ATTENDANCE_TABS = ["live", "present", "absent", "late", "leave", "incomplete"] as const;
export type AttendanceTab = (typeof ATTENDANCE_TABS)[number];

export const overviewQuerySchema = z.object({
  date: z.string().refine(isDateString).optional().catch(undefined),
  tab: z.enum(ATTENDANCE_TABS).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  department: z.string().trim().max(120).optional().catch(undefined),
  company: z.string().uuid().optional().catch(undefined),
  sort: z.enum(["name", "in", "out", "worked", "status"]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

export const historyQuerySchema = z.object({
  from: z.string().refine(isDateString).optional().catch(undefined),
  to: z.string().refine(isDateString).optional().catch(undefined),
  employee: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  department: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
