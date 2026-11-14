import { authed, db, json } from "@/server/http/api";
import { createPasswordResetLink } from "@/server/services/accounts";

/** Creates a single-use password reset link for another user (shown once). */
export const POST = authed<{ userId: string }>(async ({ actor, ctx, params }) => {
  return json({ reset: await createPasswordResetLink(db, actor, params.userId.slice(0, 64), ctx) }, { status: 201 });
});
