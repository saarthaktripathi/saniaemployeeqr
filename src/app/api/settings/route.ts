import { forbidden } from "@/lib/errors";
import { can } from "@/server/authorization/permissions";
import { authed, db, json, readJson } from "@/server/http/api";
import { getSettings, updateSettings } from "@/server/services/settings";
import type { SettingsUpdateInput } from "@/features/settings/schema";

export const GET = authed(async ({ actor }) => {
  if (!can(actor, "settings:manage")) throw forbidden();
  return json({ settings: await getSettings(db) });
});

export const PATCH = authed(async ({ req, actor, ctx }) => {
  // The body is validated by the service's Zod schema.
  const body = (await readJson(req)) as SettingsUpdateInput;
  return json({ settings: await updateSettings(db, actor, body, ctx) });
});
