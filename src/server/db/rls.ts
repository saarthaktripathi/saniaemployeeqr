import "server-only";
import { rlsScopes } from "@/server/authorization/permissions";
import type { Actor } from "@/server/services/context";
import type { Db, Tx } from "./client";

/** NOLOGIN role created by the workforce_foundation migration; subject to the RLS policies. */
export const RLS_ROLE = "sania_rls";

/**
 * Runs `fn` in one transaction under PostgreSQL row-level security for `actor`
 * (docs/DATABASE_DESIGN.md section 3). The settings are transaction-local and the role switch is
 * `SET LOCAL`, so both end at commit/rollback and never leak to other pooled requests.
 *
 * Services still check permissions first; the policies are a second, independent layer that
 * holds even if a service query forgets a filter.
 */
export async function withRls<T>(db: Db, actor: Actor, fn: (tx: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.user_id', ${actor.id}, true),
        set_config('app.employee_id', ${actor.employeeId ?? ""}, true),
        set_config('app.team', ${actor.role === "TEAM_MANAGER" ? "on" : "off"}, true),
        set_config('app.scopes', ${rlsScopes(actor)}, true)`;
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      return fn(tx);
    },
    { timeout: opts.timeout ?? 15_000, maxWait: 10_000 },
  );
}
