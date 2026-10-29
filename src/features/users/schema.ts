import { z } from "zod";
import { text } from "@/features/shared/schema";
import { GRANTABLE } from "@/server/authorization/permissions";

export const ROLES = ["OWNER", "HR_ADMIN", "HR_STAFF"] as const;

export const passwordSchema = z
  .string()
  .min(12, "At least 12 characters")
  .max(128, "At most 128 characters");

export const userCreateSchema = z
  .object({
    name: text(120, 1),
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(ROLES),
    password: passwordSchema,
    extraPermissions: z.array(z.enum(GRANTABLE as [string, ...string[]])).max(20).default([]),
  })
  .strict();

export const userUpdateSchema = z
  .object({
    name: text(120, 1).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    extraPermissions: z.array(z.enum(GRANTABLE as [string, ...string[]])).max(20).optional(),
    password: passwordSchema.optional(),
  })
  .strict();

export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
