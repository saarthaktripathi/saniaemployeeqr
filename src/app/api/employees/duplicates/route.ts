import { authed, db, json } from "@/server/http/api";
import { findDuplicateEmployees } from "@/server/services/employees";

export const GET = authed(async ({ actor, ctx }) => json(await findDuplicateEmployees(db, actor, ctx)));
