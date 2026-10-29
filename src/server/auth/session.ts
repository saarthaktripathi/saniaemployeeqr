import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { can, isPrivileged, type Permission, type Role } from "@/server/authorization/permissions";
import type { Actor, RequestContext } from "@/server/services/context";
import { getSettings } from "@/server/services/settings";
import { getAuth } from "./auth";
import { requestContextFromHeaders } from "./request";

/**
 * Resolves the authenticated actor. Role, status and permissions are re-read from
 * the database on every request so revocations take effect immediately.
 */
export async function getActorFromHeaders(h: Headers): Promise<Actor | null> {
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, isActive: true, extraPermissions: true, twoFactorEnabled: true },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    extraPermissions: user.extraPermissions,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

export async function mfaSetupRequired(actor: Actor): Promise<boolean> {
  if (!isPrivileged(actor.role) || actor.twoFactorEnabled) return false;
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
  if (!opts.allowWithoutMfa && (await mfaSetupRequired(actor))) redirect("/account/security?mfa=required");
  if (permission && !can(actor, permission)) redirect("/forbidden");
  return { actor, ctx: requestContextFromHeaders(h) };
}
