import { isWorkspaceRole, type Role } from "@/server/authorization/permissions";

/** Whether a linked employee record still allows self-service access (active and not archived). */
export function employeeAllowsAccess(e: { employmentStatus: string; archivedAt: Date | null } | null | undefined): boolean {
  return Boolean(e && e.employmentStatus === "ACTIVE" && !e.archivedAt);
}

/**
 * Whether an account may hold a session at all. Workspace-only roles (employees, team managers)
 * need a linked, active employee record: deactivating, recording an exit for or archiving the
 * employee locks the login immediately. HR roles keep console access; only their self-service
 * workspace is withdrawn.
 */
export function accountAllowsAccess(user: { isActive: boolean; role: string; employee: { employmentStatus: string; archivedAt: Date | null } | null }): boolean {
  if (!user.isActive) return false;
  if (isWorkspaceRole(user.role as Role)) return employeeAllowsAccess(user.employee);
  return true;
}
