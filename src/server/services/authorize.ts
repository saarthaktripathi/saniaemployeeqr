import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { forbidden } from "@/lib/errors";
import { can, type Permission } from "@/server/authorization/permissions";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";

/** Deny-by-default permission check; denied attempts are audited as `authz.denied`. */
export async function authorize(db: Db | Tx, actor: Actor, permission: Permission, ctx: RequestContext, target?: { type: string; id?: string }) {
  if (can(actor, permission)) return;
  await recordAudit(db, ctx, {
    actor,
    action: "authz.denied",
    targetType: target?.type,
    targetId: target?.id,
    outcome: "DENIED",
    metadata: { permission },
  });
  throw forbidden();
}
