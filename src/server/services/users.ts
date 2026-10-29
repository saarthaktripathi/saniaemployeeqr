import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/lib/errors";
import { userCreateSchema, userUpdateSchema } from "@/features/users/schema";
import { hashPassword } from "@/server/auth/password";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./employees";

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  extraPermissions: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

export async function listUsers(db: Db, actor: Actor, ctx: RequestContext) {
  await authorize(db, actor, "users:manage", ctx);
  return db.user.findMany({ select: publicUser, orderBy: [{ role: "asc" }, { name: "asc" }], take: 500 });
}

/**
 * Creates an HR/owner account with an Argon2id-hashed password in Better Auth's
 * credential account format. Public sign-up is disabled; this is the only path.
 */
export async function createUser(db: Db, actor: Actor, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "users:manage", ctx);
  const input = userCreateSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    const exists = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (exists) throw conflict("A user with this email already exists", { field: "email" });
    const id = randomUUID();
    const user = await tx.user.create({
      data: {
        id,
        name: input.name,
        email: input.email,
        emailVerified: true,
        role: input.role,
        extraPermissions: input.extraPermissions,
        accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: passwordHash } },
      },
      select: publicUser,
    });
    await recordAudit(tx, ctx, {
      actor,
      action: "users.created",
      targetType: "user",
      targetId: id,
      metadata: { role: input.role, extraPermissions: input.extraPermissions },
    });
    return user;
  });
}

export async function updateUser(db: Db, actor: Actor, userId: string, rawInput: unknown, ctx: RequestContext) {
  await authorize(db, actor, "users:manage", ctx, { type: "user", id: userId });
  const input = userUpdateSchema.parse(rawInput);
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
    if (!target) throw notFound("User");

    const losingOwner =
      target.role === "OWNER" && ((input.role && input.role !== "OWNER") || input.isActive === false);
    if (losingOwner) {
      if (userId === actor.id) throw new AppError("INVALID_STATE", "You cannot remove your own owner access");
      const owners = await tx.user.count({ where: { role: "OWNER", isActive: true } });
      if (owners <= 1) throw new AppError("INVALID_STATE", "At least one active owner is required");
    }

    const user = await tx.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        role: input.role,
        isActive: input.isActive,
        extraPermissions: input.extraPermissions,
      },
      select: publicUser,
    });
    if (passwordHash) {
      await tx.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: passwordHash } });
    }
    // Revoke sessions on deactivation, privilege change, or password reset.
    if (input.isActive === false || input.role || input.extraPermissions || passwordHash) {
      await tx.session.deleteMany({ where: { userId } });
    }
    await recordAudit(tx, ctx, {
      actor,
      action: "users.updated",
      targetType: "user",
      targetId: userId,
      metadata: {
        changed: Object.keys(input).filter((k) => k !== "password"),
        passwordReset: Boolean(passwordHash),
        role: input.role,
        isActive: input.isActive,
        extraPermissions: input.extraPermissions,
      },
    });
    return user;
  });
}
