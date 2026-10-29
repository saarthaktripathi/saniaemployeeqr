import { authed, db, json, readJson } from "@/server/http/api";
import { updateUser } from "@/server/services/users";

export const PATCH = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  return json({ user: await updateUser(db, actor, params.id.slice(0, 64), await readJson(req), ctx) });
});
