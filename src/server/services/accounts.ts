import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { baseUrl } from "@/lib/env";
import {
  acceptInviteSchema,
  accountListQuerySchema,
  employeeAccountUpdateSchema,
  inviteCreateSchema,
  resetPasswordSchema,
  type AccountState,
} from "@/features/accounts/schema";
import { can, isWorkspaceRole, type Role } from "@/server/authorization/permissions";
import { hashPassword } from "@/server/auth/password";
import { generateCredentialToken, hashToken, isWellFormedToken } from "@/server/security/crypto";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";

const INVITE_TTL_MS = 7 * 24 * 3600_000;
const RESET_TTL_MS = 24 * 3600_000;
const PAGE_SIZE = 25;

const liveToken = (now: Date) => ({ usedAt: null, revokedAt: null, expiresAt: { gt: now } });

export interface IssuedLink {
  id: string;
  /** Shown once. Only the hash is stored. */
  link: string;
  expiresAt: string;
}

export interface EmployeeAccountRow {
  employeeId: string;
  employeeCode: string;
  displayName: string;
  department: string;
  jobTitle: string;
  company: string;
  workEmail: string | null;
  photoUpdatedAt: string | null;
  state: AccountState;
  account: { userId: string; email: string; role: Role; isActive: boolean } | null;
  invite: { id: string; email: string; role: Role; expiresAt: string } | null;
}

function stateWhere(state: AccountState, now: Date): Prisma.EmployeeWhereInput {
  switch (state) {
    case "active":
      return { user: { is: { isActive: true } } };
    case "disabled":
      return { user: { is: { isActive: false } } };
    case "invited":
      return { user: { is: null }, accountTokens: { some: { kind: "INVITE", ...liveToken(now) } } };
    case "none":
      return { user: { is: null }, accountTokens: { none: { kind: "INVITE", ...liveToken(now) } } };
  }
}

/** Employees with their login state (none / invited / active / disabled), for the Employee Access page. */
export async function listEmployeeAccounts(db: Db, actor: Actor, rawQuery: unknown, ctx: RequestContext) {
  await authorize(db, actor, "account:manage", ctx);
  const query = accountListQuerySchema.parse(rawQuery);
  const now = new Date();
  const base: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    employmentStatus: "ACTIVE",
    ...(query.q
      ? {
          OR: [
            { displayName: { contains: query.q, mode: "insensitive" } },
            { employeeCode: { startsWith: query.q, mode: "insensitive" } },
            { workEmail: { startsWith: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const where: Prisma.EmployeeWhereInput = query.state ? { AND: [base, stateWhere(query.state, now)] } : base;
  const [total, rows, ...counts] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        employeeCode: true,
        displayName: true,
        department: true,
        jobTitle: true,
        workEmail: true,
        photoKey: true,
        photoUpdatedAt: true,
        company: { select: { name: true } },
        user: { select: { id: true, email: true, role: true, isActive: true } },
        accountTokens: {
          where: { kind: "INVITE", ...liveToken(now) },
          select: { id: true, email: true, role: true, expiresAt: true },
          take: 1,
        },
      },
    }),
    ...(["none", "invited", "active", "disabled"] as const).map((s) => db.employee.count({ where: { AND: [base, stateWhere(s, now)] } })),
  ]);
  const items: EmployeeAccountRow[] = rows.map((e) => {
    const invite = e.accountTokens[0];
    const state: AccountState = e.user ? (e.user.isActive ? "active" : "disabled") : invite ? "invited" : "none";
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      displayName: e.displayName,
      department: e.department,
      jobTitle: e.jobTitle,
      company: e.company.name,
      workEmail: e.workEmail,
      photoUpdatedAt: e.photoKey ? (e.photoUpdatedAt?.toISOString() ?? null) : null,
      state,
      account: e.user ? { userId: e.user.id, email: e.user.email, role: e.user.role as Role, isActive: e.user.isActive } : null,
      invite: !e.user && invite ? { id: invite.id, email: invite.email, role: invite.role as Role, expiresAt: invite.expiresAt.toISOString() } : null,
    };
  });
  const [none, invited, active, disabled] = counts;
  return { items, total, page: query.page, pageSize: PAGE_SIZE, counts: { none, invited, active, disabled } };
}

/** Login state for one employee (profile page card). */
export async function getEmployeeAccount(db: Db, actor: Actor, employeeId: string, ctx: RequestContext) {
  await authorize(db, actor, "account:manage", ctx, { type: "employee", id: employeeId });
  const now = new Date();
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      workEmail: true,
      employmentStatus: true,
      archivedAt: true,
      user: { select: { id: true, email: true, role: true, isActive: true } },
      accountTokens: { where: { kind: "INVITE", ...liveToken(now) }, select: { id: true, email: true, role: true, expiresAt: true }, take: 1 },
    },
  });
  if (!e) throw notFound("Employee");
  const invite = e.accountTokens[0];
  return {
    eligible: e.employmentStatus === "ACTIVE" && !e.archivedAt,
    workEmail: e.workEmail,
    account: e.user ? { userId: e.user.id, email: e.user.email, role: e.user.role as Role, isActive: e.user.isActive } : null,
    invite: !e.user && invite ? { id: invite.id, email: invite.email, role: invite.role as Role, expiresAt: invite.expiresAt.toISOString() } : null,
  };
}

/**
 * Creates a single-use invitation link for an existing employee record. The employee sets their
 * own password; the new account is linked to this employee (never a new employee record).
 */
export async function createInvitation(db: Db, actor: Actor, raw: unknown, ctx: RequestContext): Promise<IssuedLink> {
  await authorize(db, actor, "account:manage", ctx, { type: "employee" });
  const input = inviteCreateSchema.parse(raw);
  await enforceRateLimit(db, "invite", actor.id, RATE_RULES.accountLink);
  const token = generateCredentialToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const row = await db.$transaction(async (tx) => {
    const e = await tx.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, employmentStatus: true, archivedAt: true, user: { select: { id: true } } },
    });
    if (!e) throw notFound("Employee");
    if (e.employmentStatus !== "ACTIVE" || e.archivedAt) throw new AppError("INVALID_STATE", "Only active employees can be invited");
    if (e.user) throw conflict("This employee already has a login");
    const taken = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (taken) throw conflict("Another login already uses this email", { field: "email" });
    // One usable invitation per employee: replace any earlier one.
    await tx.accountToken.updateMany({ where: { employeeId: e.id, kind: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const created = await tx.accountToken.create({
      data: { kind: "INVITE", tokenHash: hashToken(token), email: input.email, role: input.role, employeeId: e.id, createdById: actor.id, expiresAt },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { actor, action: "account.invited", targetType: "employee", targetId: e.id, metadata: { role: input.role } });
    return created;
  });
  return { id: row.id, link: `${baseUrl()}/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

export async function revokeInvitation(db: Db, actor: Actor, inviteId: string, ctx: RequestContext) {
  await authorize(db, actor, "account:manage", ctx, { type: "account_token", id: inviteId });
  await db.$transaction(async (tx) => {
    const res = await tx.accountToken.updateMany({ where: { id: inviteId, kind: "INVITE", usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw notFound("Invitation");
    const t = await tx.accountToken.findUniqueOrThrow({ where: { id: inviteId }, select: { employeeId: true } });
    await recordAudit(tx, ctx, { actor, action: "account.invite_revoked", targetType: "employee", targetId: t.employeeId ?? undefined });
  });
}

async function findLiveToken(db: Db, token: unknown, kind: "INVITE" | "PASSWORD_RESET") {
  if (!isWellFormedToken(token)) return null;
  const row = await db.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      kind: true,
      email: true,
      role: true,
      employeeId: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      employee: { select: { displayName: true, employeeCode: true, employmentStatus: true, archivedAt: true, company: { select: { name: true } }, user: { select: { id: true } } } },
      user: { select: { id: true, name: true, isActive: true, role: true } },
    },
  });
  if (!row || row.kind !== kind || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) return null;
  return row;
}

const INVALID_LINK = "This link is invalid or has expired. Ask HR for a new one.";

/** Public: what an invitation link is for (shown before the employee sets a password). */
export async function inspectInvitation(db: Db, token: unknown) {
  const t = await findLiveToken(db, token, "INVITE");
  if (!t?.employee || t.employee.user || t.employee.employmentStatus !== "ACTIVE" || t.employee.archivedAt) return null;
  return { name: t.employee.displayName, employeeCode: t.employee.employeeCode, company: t.employee.company.name, email: t.email, expiresAt: t.expiresAt.toISOString() };
}

/** Public: accepts an invitation, creating the login linked to the employee record. */
export async function acceptInvitation(db: Db, token: unknown, raw: unknown, ctx: RequestContext) {
  await enforceRateLimit(db, "token-redeem", ctx.ipHash ?? "no-ip", RATE_RULES.tokenRedeem);
  const input = acceptInviteSchema.parse(raw);
  const t = await findLiveToken(db, token, "INVITE");
  if (!t?.employee || !t.employeeId || !t.role) throw new AppError("INVALID_STATE", INVALID_LINK);
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    // Claim the token atomically so two submissions cannot both succeed.
    const claimed = await tx.accountToken.updateMany({ where: { id: t.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError("INVALID_STATE", INVALID_LINK);
    const e = await tx.employee.findUnique({ where: { id: t.employeeId! }, select: { displayName: true, employmentStatus: true, archivedAt: true, user: { select: { id: true } } } });
    if (!e || e.user || e.employmentStatus !== "ACTIVE" || e.archivedAt) throw new AppError("INVALID_STATE", INVALID_LINK);
    const taken = await tx.user.findUnique({ where: { email: t.email }, select: { id: true } });
    if (taken) throw conflict("A login with this email already exists. Ask HR for help.");
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        name: e.displayName,
        email: t.email,
        emailVerified: true,
        role: t.role!,
        employeeId: t.employeeId!,
        accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: passwordHash } },
      },
    });
    await recordAudit(tx, ctx, { actor: { id, role: t.role! }, action: "account.invite_accepted", targetType: "employee", targetId: t.employeeId!, metadata: { role: t.role } });
    return { email: t.email };
  });
}

/**
 * Creates a single-use password reset link. HR (account:manage) may reset employee and team
 * manager logins; HR, management and owner accounts need users:manage (owners).
 */
export async function createPasswordResetLink(db: Db, actor: Actor, userId: string, ctx: RequestContext): Promise<IssuedLink> {
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, isActive: true } });
  const needed = target && isWorkspaceRole(target.role as Role) ? "account:manage" : "users:manage";
  await authorize(db, actor, needed, ctx, { type: "user", id: userId });
  if (!target) throw notFound("User");
  if (!target.isActive) throw new AppError("INVALID_STATE", "Activate the account before resetting its password");
  if (target.id === actor.id) throw new AppError("INVALID_STATE", "Use Account settings to change your own password");
  await enforceRateLimit(db, "reset-link", actor.id, RATE_RULES.accountLink);
  const token = generateCredentialToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  const row = await db.$transaction(async (tx) => {
    await tx.accountToken.updateMany({ where: { userId, kind: "PASSWORD_RESET", usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const created = await tx.accountToken.create({
      data: { kind: "PASSWORD_RESET", tokenHash: hashToken(token), email: target.email, userId, createdById: actor.id, expiresAt },
      select: { id: true },
    });
    await recordAudit(tx, ctx, { actor, action: "account.reset_link_created", targetType: "user", targetId: userId });
    return created;
  });
  return { id: row.id, link: `${baseUrl()}/reset-password/${token}`, expiresAt: expiresAt.toISOString() };
}

export async function inspectPasswordReset(db: Db, token: unknown) {
  const t = await findLiveToken(db, token, "PASSWORD_RESET");
  if (!t?.user?.isActive) return null;
  return { name: t.user.name, email: t.email, expiresAt: t.expiresAt.toISOString() };
}

/** Public: sets a new password from a reset link and signs the account out everywhere. */
export async function completePasswordReset(db: Db, token: unknown, raw: unknown, ctx: RequestContext) {
  await enforceRateLimit(db, "token-redeem", ctx.ipHash ?? "no-ip", RATE_RULES.tokenRedeem);
  const input = resetPasswordSchema.parse(raw);
  const t = await findLiveToken(db, token, "PASSWORD_RESET");
  if (!t?.user?.isActive || !t.userId) throw new AppError("INVALID_STATE", INVALID_LINK);
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    const claimed = await tx.accountToken.updateMany({ where: { id: t.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError("INVALID_STATE", INVALID_LINK);
    await tx.account.updateMany({ where: { userId: t.userId!, providerId: "credential" }, data: { password: passwordHash } });
    await tx.session.deleteMany({ where: { userId: t.userId! } });
    await recordAudit(tx, ctx, { actor: { id: t.userId!, role: t.user!.role }, action: "account.password_reset", targetType: "user", targetId: t.userId! });
  });
  return { email: t.email };
}

/** HR: activate/deactivate an employee login or switch it between Employee and Team Manager. */
export async function updateEmployeeAccount(db: Db, actor: Actor, userId: string, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "account:manage", ctx, { type: "user", id: userId });
  const input = employeeAccountUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, employeeId: true } });
    if (!target) throw notFound("User");
    // HR administrators manage employee logins only; HR/owner accounts are managed by owners.
    if (!isWorkspaceRole(target.role as Role) && !can(actor, "users:manage")) throw forbidden();
    if (!isWorkspaceRole(target.role as Role)) throw new AppError("INVALID_STATE", "Manage this account from Users & Access");
    const user = await tx.user.update({
      where: { id: userId },
      data: { isActive: input.isActive, role: input.role },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (input.isActive === false || (input.role && input.role !== target.role)) await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, ctx, {
      actor,
      action: input.isActive === false ? "account.deactivated" : input.isActive === true && !target.isActive ? "account.activated" : "account.updated",
      targetType: "employee",
      targetId: target.employeeId ?? undefined,
      metadata: { role: input.role, isActive: input.isActive },
    });
    return user;
  });
}
