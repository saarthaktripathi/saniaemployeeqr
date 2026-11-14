import { z } from "zod";
import { isoDate, optionalIsoDate, optionalText, patchEnum, patchIsoDate, patchText, patchUrl, patchUuid, text } from "@/features/shared/schema";
import { EMPLOYMENT_TYPES, EXIT_TYPES, WORK_MODES } from "./labels";

const email = z.union([z.string().trim().toLowerCase().email("Invalid email").max(254), z.literal(""), z.null()]).optional()
  .transform((v) => (v ? v : null));

const phone = z
  .union([z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Invalid phone number"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const employeeFields = {
  firstName: text(80, 1),
  lastName: text(80).default(""),
  displayName: optionalText(160),
  workEmail: email,
  phone,
  department: text(80, 1),
  jobTitle: text(120, 1),
  businessVertical: optionalText(120),
  workLocation: optionalText(120),
  joiningDate: optionalIsoDate,
  idIssueDate: optionalIsoDate,
  idExpiresAt: optionalIsoDate,
  // Directory fields use patch semantics: an absent key leaves the stored value unchanged.
  /** Omitted on create: the only active company is used (required when there are several). */
  companyId: patchUuid,
  employmentType: patchEnum(EMPLOYMENT_TYPES),
  workMode: patchEnum(WORK_MODES),
  team: patchText(80),
  reportingManagerId: patchUuid,
  attendanceRef: patchText(60),
  leavePolicy: patchText(120),
  leaveSystemUrl: patchUrl,
};

const createFields = {
  ...employeeFields,
  /** Initial status only; later changes go through the audited status actions. */
  employmentStatus: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(["ACTIVE", "INACTIVE"])).default("ACTIVE"),
};
const issueBeforeExpiry: [(v: { idIssueDate: Date | null; idExpiresAt: Date | null }) => boolean, { message: string; path: string[] }] = [
  (v) => !v.idIssueDate || !v.idExpiresAt || v.idExpiresAt >= v.idIssueDate,
  { message: "Expiry must be on or after the issue date", path: ["idExpiresAt"] },
];

/** Create payload. `.strict()` rejects unknown keys (mass-assignment protection). */
export const employeeCreateSchema = z
  .object(createFields)
  .strict()
  .refine(...issueBeforeExpiry);

/** Client-side create form validation: same rules, but the shared form's edit-only fields are ignored. */
export const employeeCreateFormSchema = z.object(createFields).refine(...issueBeforeExpiry);

const updateFields = {
  ...employeeFields,
  idIssueDate: isoDate,
  idExpiresAt: isoDate,
  // Exit details can be corrected here once an exit has been recorded (see exitSchema).
  exitDate: patchIsoDate,
  exitType: patchEnum(EXIT_TYPES),
  exitReason: patchText(300),
};
const datesOrdered: [(v: { idIssueDate: Date; idExpiresAt: Date }) => boolean, { message: string; path: string[] }] = [
  (v) => v.idExpiresAt >= v.idIssueDate,
  { message: "Expiry must be on or after the issue date", path: ["idExpiresAt"] },
];

export const employeeUpdateSchema = z
  .object({ ...updateFields, version: z.number().int().positive() })
  .strict()
  .refine(...datesOrdered);

/** Client-side edit form validation (version is supplied separately). */
export const employeeEditFormSchema = z.object(updateFields).refine(...datesOrdered);

export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.input<typeof employeeUpdateSchema>;

export const STATUS_FILTERS = ["ACTIVE", "INACTIVE", "EXITED", "ARCHIVED", "ALL"] as const;
export const CREDENTIAL_FILTERS = ["ANY", "VALID", "NONE", "EXPIRED"] as const;
export const EXPIRY_FILTERS = ["ANY", "VALID", "EXPIRING_SOON", "EXPIRED"] as const;
export const SORT_FIELDS = ["name", "code", "department", "idExpiresAt", "createdAt", "joiningDate"] as const;

const uuidOrEmpty = z.union([z.string().uuid(), z.literal("")]).optional().default("");

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(STATUS_FILTERS).default("ALL"),
  company: uuidOrEmpty,
  department: z.string().trim().max(80).optional().default(""),
  designation: z.string().trim().max(120).optional().default(""),
  type: z.enum(["ANY", ...EMPLOYMENT_TYPES]).default("ANY"),
  mode: z.enum(["ANY", ...WORK_MODES]).default("ANY"),
  /** Direct reports of this employee. */
  manager: uuidOrEmpty,
  credential: z.enum(CREDENTIAL_FILTERS).default("ANY"),
  expiry: z.enum(EXPIRY_FILTERS).default("ANY"),
  sort: z.enum(SORT_FIELDS).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const STATUS_ACTIONS = ["deactivate", "reactivate", "archive", "unarchive"] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

export const statusActionSchema = z
  .object({
    action: z.enum(STATUS_ACTIONS),
    reason: optionalText(300),
  })
  .strict();

export const bulkStatusSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(STATUS_ACTIONS),
    reason: optionalText(300),
  })
  .strict();

export const revokeSchema = z.object({ reason: text(300, 1) }).strict();

/** "Record exit": last working day (not in the future), type and optional reason. */
export const exitSchema = z
  .object({
    exitDate: isoDate,
    exitType: z.enum(EXIT_TYPES),
    reason: optionalText(300),
  })
  .strict();

/** Permanent deletion (single, bulk or duplicate cleanup). Larger cap than status changes so a whole duplicated import can be removed at once. */
export const DELETE_LIMIT = 1000;

export const deleteEmployeesSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(DELETE_LIMIT),
    reason: text(300, 1),
  })
  .strict();
