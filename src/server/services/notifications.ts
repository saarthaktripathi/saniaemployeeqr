import "server-only";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { withRls } from "@/server/db/rls";
import { can, type Permission, type Role } from "@/server/authorization/permissions";
import type { Actor } from "./context";
import { emitEvent } from "./outbox";

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string | null;
  /** App-relative path. */
  link?: string | null;
  entityType?: string;
  entityId?: string;
  /** Same recipient + key is stored once (idempotent reminders). */
  dedupeKey?: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

/**
 * Delivers one notification to each recipient inside the caller's transaction (commits with the
 * change it describes) and pushes a real-time event to exactly those users. Uses INSERT without
 * RETURNING so it also works under RLS, where the sender cannot read other users' rows.
 */
export async function notify(tx: Db | Tx, recipientIds: string[], draft: NotificationDraft): Promise<void> {
  const unique = [...new Set(recipientIds)].filter(Boolean);
  if (unique.length === 0) return;
  const link = draft.link && draft.link.startsWith("/") && !draft.link.startsWith("//") ? draft.link.slice(0, 300) : null;
  await tx.notification.createMany({
    data: unique.map((recipientId) => ({
      recipientId,
      type: draft.type.slice(0, 60),
      title: draft.title.slice(0, 160),
      body: clip(draft.body, 500),
      link,
      entityType: draft.entityType ?? null,
      entityId: draft.entityId ?? null,
      dedupeKey: draft.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  await emitEvent(tx, "notification.created", { audience: unique });
}

/**
 * Active console users holding `permission` (e.g. leave approvers). Workspace roles never hold
 * organisation-wide permissions, so they are excluded by construction.
 */
export async function usersWithPermission(tx: Db | Tx, permission: Permission, opts: { only?: (u: { notifyPunches: boolean }) => boolean } = {}): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { isActive: true, role: { in: ["OWNER", "HR_ADMIN", "HR_STAFF", "MANAGEMENT"] } },
    select: { id: true, role: true, extraPermissions: true, notifyPunches: true },
    take: 500,
  });
  return users.filter((u) => can({ id: u.id, role: u.role as Role, extraPermissions: u.extraPermissions }, permission) && (opts.only?.(u) ?? true)).map((u) => u.id);
}

const listQuery = z.object({
  unread: z.enum(["1", "0"]).optional().catch(undefined),
  before: z.string().datetime().optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).default(20).catch(20),
});

/** The signed-in user's notifications, newest first (cursor = createdAt of the last row). */
export async function listMyNotifications(db: Db, actor: Actor, raw: unknown) {
  const q = listQuery.parse(raw ?? {});
  return withRls(db, actor, async (tx) => {
    const [rows, unread] = await Promise.all([
      tx.notification.findMany({
        where: { recipientId: actor.id, ...(q.unread === "1" ? { readAt: null } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: q.limit + 1,
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      tx.notification.count({ where: { recipientId: actor.id, readAt: null } }),
    ]);
    const page = rows.slice(0, q.limit);
    return {
      unread,
      items: page.map<NotificationRow>((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
      nextBefore: rows.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  });
}

export async function unreadNotificationCount(db: Db, actor: Actor): Promise<number> {
  return withRls(db, actor, (tx) => tx.notification.count({ where: { recipientId: actor.id, readAt: null } }));
}

const markSchema = z.union([z.object({ all: z.literal(true) }).strict(), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict()]);

/** Marks the caller's own notifications read (RLS makes other users' rows unreachable). */
export async function markNotificationsRead(db: Db, actor: Actor, raw: unknown): Promise<number> {
  const input = markSchema.parse(raw);
  return withRls(db, actor, async (tx) => {
    const res = await tx.notification.updateMany({
      where: { recipientId: actor.id, readAt: null, ...("ids" in input ? { id: { in: input.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return res.count;
  });
}
