import { can, type Permission, type Principal } from "@/server/authorization/permissions";

/** Whether a subscriber may receive an event: named in its audience, or holding its scope permission. */
export function canReceive(actor: Principal, payload: Record<string, unknown>): boolean {
  const audience = Array.isArray(payload.audience) ? (payload.audience as unknown[]) : null;
  const scope = payload.scope as Permission | undefined;
  if (audience?.includes(actor.id)) return true;
  if (scope) return can(actor, scope);
  // Audience-only events go to their audience and nobody else.
  return audience ? false : can(actor, "employee:read");
}
