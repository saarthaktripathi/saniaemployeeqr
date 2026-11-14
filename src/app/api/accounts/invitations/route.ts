import { authed, db, json, readJson } from "@/server/http/api";
import { createInvitation } from "@/server/services/accounts";

/** Creates a single-use invitation link (shown once). */
export const POST = authed(async ({ req, actor, ctx }) => {
  return json({ invitation: await createInvitation(db, actor, await readJson(req), ctx) }, { status: 201 });
});
