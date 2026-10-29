import { z } from "zod";
import { text } from "@/features/shared/schema";

export const settingsUpdateSchema = z
  .object({
    companyName: text(120, 1),
    tagline: text(200),
    employeeIdPrefix: z.string().trim().regex(/^[A-Z]{2,6}$/, "2–6 uppercase letters"),
    defaultIdValidityDays: z.coerce.number().int().min(1).max(3650),
    credentialValidityDays: z.coerce.number().int().min(1).max(3650),
    expiryWarningDays: z.coerce.number().int().min(1).max(365),
    publicShowDepartment: z.boolean(),
    publicShowJobTitle: z.boolean(),
    publicShowBusinessVertical: z.boolean(),
    publicShowWorkLocation: z.boolean(),
    auditRetentionDays: z.coerce.number().int().min(90).max(3650),
    verificationRetentionDays: z.coerce.number().int().min(7).max(730),
    requireMfaForPrivileged: z.boolean(),
  })
  .strict()
  .partial();

export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>;
