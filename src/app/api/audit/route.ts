import { authed, db, json } from "@/server/http/api";
import { listAudit } from "@/server/services/audit-read";

export const GET = authed(async ({ req, actor, ctx }) =>
  json(await listAudit(db, actor, Object.fromEntries(req.nextUrl.searchParams), ctx)),
);
