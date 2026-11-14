import { z } from "zod";
import { passwordSchema } from "@/features/users/schema";

export const INVITE_ROLES = ["EMPLOYEE", "TEAM_MANAGER"] as const;

export const inviteCreateSchema = z
  .object({
    employeeId: z.string().uuid("Choose an employee"),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
    role: z.enum(INVITE_ROLES, { error: "Choose Employee or Team Manager" }).default("EMPLOYEE"),
  })
  .strict();

export const acceptInviteSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const resetPasswordSchema = acceptInviteSchema;

export const employeeAccountUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: z.enum(INVITE_ROLES).optional(),
  })
  .strict()
  .refine((v) => v.isActive !== undefined || v.role !== undefined, { message: "Nothing to change" });

export const ACCOUNT_STATES = ["none", "invited", "active", "disabled"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const accountListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(ACCOUNT_STATES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

export type InviteCreateInput = z.input<typeof inviteCreateSchema>;
