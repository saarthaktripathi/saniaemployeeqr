import { authed, db, json } from "@/server/http/api";
import { getDashboardStats } from "@/server/services/dashboard";

export const GET = authed(async ({ actor, ctx }) => json(await getDashboardStats(db, actor, ctx)));
