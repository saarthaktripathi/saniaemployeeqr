import { authed, db, json, readJson } from "@/server/http/api";
import { listAnnouncements, sendAnnouncement } from "@/server/services/announcements";

export const GET = authed(async ({ actor, ctx }) => json({ announcements: await listAnnouncements(db, actor, ctx) }));

/** Body: { title, body, audience: { kind: "all" } | { kind: "company", companyId } | { kind: "department", department } }. */
export const POST = authed(async ({ req, actor, ctx }) => json({ announcement: await sendAnnouncement(db, actor, await readJson(req), ctx) }, { status: 201 }));
