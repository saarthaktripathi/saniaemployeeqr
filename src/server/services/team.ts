import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { can } from "@/server/authorization/permissions";
import type { Actor } from "./context";

/** Reporting chains are short; this bounds the walk even if bad data ever formed a loop. */
const MAX_DEPTH = 50;

/**
 * Ids of everyone who reports to `managerEmployeeId`, directly or indirectly (excluding the
 * manager), among records that are not archived.
 */
export async function teamMemberIds(db: Db | Tx, managerEmployeeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE team AS (
      SELECT e."id", 1 AS depth FROM "employee" e WHERE e."reportingManagerId" = ${managerEmployeeId}::uuid AND e."archivedAt" IS NULL
      UNION
      SELECT e."id", t.depth + 1 FROM "employee" e JOIN team t ON e."reportingManagerId" = t."id"
      WHERE e."archivedAt" IS NULL AND t.depth < ${MAX_DEPTH}
    )
    SELECT DISTINCT "id"::text AS id FROM team WHERE "id" <> ${managerEmployeeId}::uuid`;
  return rows.map((r) => r.id);
}

/** Whether `targetId` is in the reporting tree below `managerEmployeeId`. */
export async function isInTeam(db: Db | Tx, managerEmployeeId: string, targetId: string): Promise<boolean> {
  if (managerEmployeeId === targetId) return false;
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    WITH RECURSIVE up AS (
      SELECT e."reportingManagerId" AS mid, 1 AS depth FROM "employee" e WHERE e."id" = ${targetId}::uuid
      UNION ALL
      SELECT e."reportingManagerId", u.depth + 1 FROM "employee" e JOIN up u ON e."id" = u.mid
      WHERE u.mid IS NOT NULL AND u.depth < ${MAX_DEPTH}
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE mid = ${managerEmployeeId}::uuid) AS found`;
  return Boolean(rows[0]?.found);
}

/** Whether the actor is a team manager for `targetId` (has the role and the employee reports to them). */
export async function managesEmployee(db: Db | Tx, actor: Actor, targetId: string): Promise<boolean> {
  return actor.role === "TEAM_MANAGER" && Boolean(actor.employeeId) && (await isInTeam(db, actor.employeeId!, targetId));
}

/**
 * Self, HR with organisation-wide read access to `scope`, or the employee's team manager.
 * Used by services before touching data; RLS enforces the same rule underneath.
 */
export async function canViewEmployee(db: Db | Tx, actor: Actor, targetId: string, scope: Parameters<typeof can>[1] = "employee:read"): Promise<boolean> {
  if (actor.employeeId === targetId) return true;
  if (can(actor, scope)) return true;
  return managesEmployee(db, actor, targetId);
}

/**
 * User ids of the active Team Manager logins above an employee in the reporting chain. Used as
 * the real-time audience for team events (managers see their team's attendance live).
 */
export async function managerUserIds(db: Db | Tx, employeeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE up AS (
      SELECT e."reportingManagerId" AS mid, 1 AS depth FROM "employee" e WHERE e."id" = ${employeeId}::uuid
      UNION ALL
      SELECT e."reportingManagerId", u.depth + 1 FROM "employee" e JOIN up u ON e."id" = u.mid
      WHERE u.mid IS NOT NULL AND u.depth < ${MAX_DEPTH}
    )
    SELECT u."id" FROM "user" u JOIN up ON u."employeeId" = up.mid
    WHERE u."role" = 'TEAM_MANAGER' AND u."isActive" = true`;
  return rows.map((r) => r.id);
}
