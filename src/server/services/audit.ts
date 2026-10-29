import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db/client";
import type { Actor, RequestContext } from "./context";
import { emitEvent } from "./outbox";
import { SYSTEM_ACTOR_ID } from "./context";

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED";

/** Security-sensitive action prefixes, visible only with audit:read:security. */
export const SECURITY_ACTION_PREFIXES = ["auth.", "users.", "settings.", "authz."] as const;

export function isSecurityAction(action: string): boolean {
  return SECURITY_ACTION_PREFIXES.some((p) => action.startsWith(p));
}

export interface AuditInput {
  actor?: Pick<Actor, "id" | "role"> | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an audit record (and a minimal real-time notification) using the given
 * client/transaction, so the audit entry commits or rolls back with the change it describes.
 */
export async function recordAudit(client: Db | Tx, ctx: RequestContext, input: AuditInput): Promise<void> {
  const row = await client.auditLog.create({
    data: {
      actorId: input.actor && input.actor.id !== SYSTEM_ACTOR_ID ? input.actor.id : null,
      actorRole: input.actor?.id === SYSTEM_ACTOR_ID ? "SYSTEM" : (input.actor?.role ?? null),
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome ?? "SUCCESS",
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: ctx.requestId,
      ipHash: ctx.ipHash,
    },
    select: { id: true },
  });
  await emitEvent(client, "audit.created", {
    auditId: row.id.toString(),
    scope: isSecurityAction(input.action) ? "audit:read:security" : "audit:read",
  });
}
