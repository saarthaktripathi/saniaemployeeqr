import { authed, db, json, readJson } from "@/server/http/api";
import { correctAttendance, listCorrections } from "@/server/services/attendance-corrections";

export const GET = authed(async ({ req, actor, ctx }) => {
  const p = req.nextUrl.searchParams;
  return json(await listCorrections(db, actor, { status: p.get("status") ?? undefined, employee: p.get("employee") ?? undefined, page: Number(p.get("page") ?? 1) }, ctx));
});

/** HR corrects attendance directly (or resolves an incomplete session); recorded as an applied correction. */
export const POST = authed(async ({ req, actor, ctx }) => json({ correction: await correctAttendance(db, actor, await readJson(req), ctx) }, { status: 201 }));
