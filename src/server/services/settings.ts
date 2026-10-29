import "server-only";
import type { CompanySettings } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { forbidden } from "@/lib/errors";
import { can } from "@/server/authorization/permissions";
import { settingsUpdateSchema, type SettingsUpdateInput } from "@/features/settings/schema";
import type { Actor, RequestContext } from "./context";
import { recordAudit } from "./audit";

export async function getSettings(db: Db): Promise<CompanySettings> {
  return db.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function updateSettings(
  db: Db,
  actor: Actor,
  input: SettingsUpdateInput,
  ctx: RequestContext,
): Promise<CompanySettings> {
  if (!can(actor, "settings:manage")) {
    await recordAudit(db, ctx, { actor, action: "authz.denied", targetType: "settings", outcome: "DENIED" });
    throw forbidden();
  }
  const data = settingsUpdateSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    const after = await tx.companySettings.update({ where: { id: 1 }, data: { ...data, updatedById: actor.id } });
    const changed = Object.keys(data).filter(
      (k) => before[k as keyof CompanySettings] !== after[k as keyof CompanySettings],
    );
    await recordAudit(tx, ctx, {
      actor,
      action: "settings.updated",
      targetType: "settings",
      targetId: "1",
      metadata: { changed },
    });
    return after;
  });
}
