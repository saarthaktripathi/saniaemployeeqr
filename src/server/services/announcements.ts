import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";
import { authorize } from "./authorize";
import { notify } from "./notifications";

export const announcementSchema = z
  .object({
    title: z.string().trim().min(3, "Add a title").max(120),
    body: z.string().trim().min(3, "Write the announcement").max(2000),
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }).strict(),
      z.object({ kind: z.literal("company"), companyId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal("department"), department: z.string().trim().min(1).max(120) }).strict(),
    ]),
  })
  .strict();

/**
 * HR broadcast to every active login (all), or to employees of one company or department.
 * Delivered as one in-app notification per recipient.
 */
export async function sendAnnouncement(db: Db, actor: Actor, raw: unknown, ctx: RequestContext) {
  await authorize(db, actor, "announcement:send", ctx, { type: "announcement" });
  const input = announcementSchema.parse(raw);
  await enforceRateLimit(db, "announce", actor.id, RATE_RULES.bulk);
  const a = input.audience;
  const where: Prisma.UserWhereInput =
    a.kind === "all"
      ? { isActive: true }
      : {
          isActive: true,
          employee: { is: { archivedAt: null, employmentStatus: "ACTIVE", ...(a.kind === "company" ? { companyId: a.companyId } : { department: { equals: a.department, mode: "insensitive" } }) } },
        };
  const users = await db.user.findMany({ where, select: { id: true }, take: 5000 });
  const recipients = users.map((u) => u.id).filter((id) => id !== actor.id);
  if (recipients.length === 0) throw new AppError("VALIDATION", "Nobody with a login matches that audience");
  return db.$transaction(async (tx) => {
    const row = await tx.announcement.create({ data: { title: input.title, body: input.body, audience: a as Prisma.InputJsonValue, recipientCount: recipients.length, createdById: actor.id }, select: { id: true } });
    for (let i = 0; i < recipients.length; i += 500) {
      await notify(tx, recipients.slice(i, i + 500), { type: "announcement", title: input.title, body: input.body.slice(0, 500), link: `/me/notifications`, entityType: "announcement", entityId: row.id });
    }
    await recordAudit(tx, ctx, { actor, action: "announcement.sent", targetType: "announcement", targetId: row.id, metadata: { audience: a.kind, recipients: recipients.length } });
    return { id: row.id, recipients: recipients.length };
  });
}

export async function listAnnouncements(db: Db, actor: Actor, ctx: RequestContext) {
  await authorize(db, actor, "announcement:send", ctx, { type: "announcement" });
  const rows = await db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, body: true, audience: true, recipientCount: true, createdAt: true, createdBy: { select: { name: true } } } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), createdBy: r.createdBy?.name ?? "Former user" }));
}
