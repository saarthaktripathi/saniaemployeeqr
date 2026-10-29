import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { can } from "@/server/authorization/permissions";
import type { Actor, RequestContext } from "./context";
import { authorize } from "./employees";
import { SECURITY_ACTION_PREFIXES } from "./audit";

export const auditQuerySchema = z.object({
  cursor: z.string().regex(/^\d{1,19}$/).optional(),
  action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional().default(""),
  targetId: z.string().trim().max(64).optional().default(""),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED", ""]).optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  outcome: string;
  actorName: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
}

/** Keyset (cursor) pagination on the monotonically increasing id, newest first. */
export async function listAudit(db: Db, actor: Actor, rawQuery: unknown, ctx: RequestContext) {
  await authorize(db, actor, "audit:read", ctx);
  const q = auditQuerySchema.parse(rawQuery ?? {});
  const and: Prisma.AuditLogWhereInput[] = [];
  if (!can(actor, "audit:read:security")) {
    and.push({ NOT: { OR: SECURITY_ACTION_PREFIXES.map((p) => ({ action: { startsWith: p } })) } });
  }
  if (q.action) and.push({ action: { startsWith: q.action } });
  if (q.targetId) and.push({ targetId: q.targetId });
  if (q.outcome) and.push({ outcome: q.outcome });
  if (q.cursor) and.push({ id: { lt: BigInt(q.cursor) } });

  const rows = await db.auditLog.findMany({
    where: { AND: and },
    orderBy: { id: "desc" },
    take: q.limit + 1,
    include: { actor: { select: { name: true } } },
  });
  const page = rows.slice(0, q.limit);
  return {
    rows: page.map(
      (r): AuditRow => ({
        id: r.id.toString(),
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        outcome: r.outcome,
        actorName: r.actor?.name ?? null,
        actorRole: r.actorRole,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: r.metadata,
      }),
    ),
    nextCursor: rows.length > q.limit ? page[page.length - 1].id.toString() : null,
  };
}
