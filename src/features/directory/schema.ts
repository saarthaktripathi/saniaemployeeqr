import { z } from "zod";
import { isoDate, optionalText, text } from "@/features/shared/schema";
import { COMPENSATION_TYPES, DOCUMENT_CATEGORIES, HISTORY_KINDS, PAY_FREQUENCIES } from "@/features/employees/labels";

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const companyCode = z
  .union([z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "2–8 letters or digits"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

export const companyCreateSchema = z
  .object({
    name: text(120, 1),
    code: companyCode,
  })
  .strict();

export const companyUpdateSchema = z
  .object({
    name: text(120, 1).optional(),
    code: companyCode,
    isActive: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Compensation (restricted)
// ---------------------------------------------------------------------------

/** Up to 12 integer digits and 2 decimals (DECIMAL(14,2)); Indian/Western digit grouping is accepted. */
const amount = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).replace(/[,\s]/g, ""))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount such as 45000 or 45000.50");

export const compensationCreateSchema = z
  .object({
    type: z.enum(COMPENSATION_TYPES),
    amount,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter currency code, e.g. INR").default("INR"),
    frequency: z.enum(PAY_FREQUENCIES),
    effectiveFrom: isoDate,
    notes: optionalText(300),
  })
  .strict();

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export function documentTypeAllowed(type: string): boolean {
  return (DOCUMENT_TYPES as readonly string[]).includes(type);
}

export const documentMetaSchema = z
  .object({
    category: z.enum(DOCUMENT_CATEGORIES),
    title: text(120, 1),
    fileName: text(200, 1),
    notes: optionalText(300),
  })
  .strict();

// ---------------------------------------------------------------------------
// Employment history (manual entries)
// ---------------------------------------------------------------------------

export const historyEntrySchema = z
  .object({
    kind: z.enum(HISTORY_KINDS),
    effectiveDate: isoDate,
    fromValue: optionalText(160),
    toValue: optionalText(160),
    note: optionalText(300),
  })
  .strict()
  .refine((v) => v.toValue || v.note, { message: "Add the new value or a note", path: ["toValue"] });
