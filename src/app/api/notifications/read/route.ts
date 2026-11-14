import { authed, db, json, readJson } from "@/server/http/api";
import { markNotificationsRead } from "@/server/services/notifications";

/** Body: { ids: string[] } or { all: true }. Only the caller's own notifications are affected. */
export const POST = authed(async ({ req, actor }) => json({ updated: await markNotificationsRead(db, actor, await readJson(req)) }));
