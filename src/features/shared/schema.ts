import { z } from "zod";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed single-line text with no control characters. */
export const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min, min > 0 ? "Required" : undefined)
    .max(max, `Must be ${max} characters or fewer`)
    .refine((v) => !CONTROL.test(v) && !/[\r\n]/.test(v), "Contains invalid characters");

/** Optional text: empty string becomes null. */
export const optionalText = (max: number) =>
  z.union([text(max), z.null()]).optional().transform((v) => (v ? v : null));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date as "YYYY-MM-DD" → Date at UTC midnight. */
export const isoDate = z
  .string()
  .regex(DATE_RE, "Use YYYY-MM-DD")
  .transform((v, ctx) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

export const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

export const uuid = z.string().uuid("Invalid identifier");

export function toIsoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
