import { authed, db, json } from "@/server/http/api";
import { listMyNotifications } from "@/server/services/notifications";
import { maybeRunSweeps } from "@/server/services/sweeps";

/** The signed-in user's own notifications (?unread=1, ?before=<iso> for paging). */
export const GET = authed(async ({ req, actor }) => {
  // The bell loads on every page, so this doubles as the (throttled) reminder scheduler.
  maybeRunSweeps(db);
  return json(await listMyNotifications(db, actor, Object.fromEntries(req.nextUrl.searchParams)));
});
