import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { can, isWorkspaceRole, requiresMfa, type Permission, type Role } from "@/server/authorization/permissions";
import type { Actor, RequestContext } from "@/server/services/context";
import { getSettings } from "@/server/services/settings";
import { mfaEnabled } from "@/lib/env";
import { getAuth } from "./auth";
import { requestContextFromHeaders } from "./request";
import { accountAllowsAccess, employeeAllowsAccess } from "./access";

/**
 * Resolves the authenticated actor. Role, status, permissions and the employee link are re-read
 * from the database on every request so revocations take effect immediately.
 */
export async function getActorFromHeaders(h: Headers): Promise<Actor | null> {
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      extraPermissions: true,
      twoFactorEnabled: true,
      employeeId: true,
      employee: { select: { employmentStatus: true, archivedAt: true } },
    },
  });
  if (!user || !accountAllowsAccess(user)) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    extraPermissions: user.extraPermissions,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    employeeId: employeeAllowsAccess(user.employee) ? user.employeeId : null,
  };
}

export async function mfaSetupRequired(actor: Actor): Promise<boolean> {
  if (!mfaEnabled() || !requiresMfa(actor) || actor.twoFactorEnabled) return false;
  return (await getSettings(db)).requireMfaForPrivileged;
}

export interface PageAuth {
  actor: Actor;
  ctx: RequestContext;
}

/**
 * For server components/pages: requires a signed-in actor (and optionally a permission).
 * Redirects to login, MFA enrolment, or the forbidden page as appropriate.
 */
export async function requirePageActor(permission?: Permission, opts: { allowWithoutMfa?: boolean } = {}): Promise<PageAuth> {
  const h = await headers();
  const actor = await getActorFromHeaders(h);
  if (!actor) redirect("/login");
  if (!opts.allowWithoutMfa && (await mfaSetupRequired(actor))) redirect(isWorkspaceRole(actor.role) ? "/me/settings?mfa=required" : "/account/security?mfa=required");
  if (permission && !can(actor, permission)) redirect("/forbidden");
  return { actor, ctx: requestContextFromHeaders(h) };
}

export interface WorkspaceAuth extends PageAuth {
  actor: Actor & { employeeId: string };
}

/**
 * For employee workspace pages (/me): requires a signed-in account linked to an active
 * employee record. HR accounts without a linked record are sent back to the HR console.
 */
export async function requireWorkspaceActor(opts: { allowWithoutMfa?: boolean } = {}): Promise<WorkspaceAuth> {
  const auth = await requirePageActor(undefined, opts);
  if (!auth.actor.employeeId) redirect(isWorkspaceRole(auth.actor.role) ? "/login" : "/dashboard");
  return auth as WorkspaceAuth;
}

/** Where an actor lands after signing in. */
export function homePathFor(actor: Actor): string {
  return isWorkspaceRole(actor.role) ? "/me" : "/dashboard";
}
