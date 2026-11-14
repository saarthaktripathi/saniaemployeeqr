import { authed, db, json, readJson } from "@/server/http/api";
import { uuidParam } from "@/server/http/params";
import { recordExit } from "@/server/services/employees";

/** Records an exit: { exitDate: "YYYY-MM-DD", exitType, reason? }. The employee becomes inactive. */
export const POST = authed<{ id: string }>(async ({ req, actor, ctx, params }) => {
  const employee = await recordExit(db, actor, uuidParam(params.id), await readJson(req), ctx);
  return json({ employee });
});
