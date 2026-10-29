import type { Role } from "@/server/authorization/permissions";

/** The authenticated user performing an operation. Built only from server-verified session data. */
export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
  extraPermissions: string[];
  twoFactorEnabled: boolean;
}

/** Per-request metadata passed to services for auditing and rate limiting. */
export interface RequestContext {
  requestId: string;
  ipHash: string | null;
}

export const systemContext = (requestId = "system"): RequestContext => ({ requestId, ipHash: null });

/** Actor id used by CLI bootstrap/seed scripts; audited with a null actor and role SYSTEM. */
export const SYSTEM_ACTOR_ID = "system";

export const systemActor = (): Actor => ({ id: SYSTEM_ACTOR_ID, email: "system", name: "System", role: "OWNER", extraPermissions: [], twoFactorEnabled: false });
