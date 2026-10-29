import { authed, db, json, readJson } from "@/server/http/api";
import { createUser, listUsers } from "@/server/services/users";

export const GET = authed(async ({ actor, ctx }) => json({ users: await listUsers(db, actor, ctx) }));

export const POST = authed(async ({ req, actor, ctx }) => {
  return json({ user: await createUser(db, actor, await readJson(req), ctx) }, { status: 201 });
});
