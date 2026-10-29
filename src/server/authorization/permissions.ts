/**
 * Central permission model. Deny by default: a permission is granted only if
 * the user's role includes it or it appears in the user's extraPermissions.
 * Pure module (no server-only import) so it can be unit tested and shared with UI
 * for display purposes — the server remains the only enforcement point.
 */
export const PERMISSIONS = [
  "employee:read",
  "employee:create",
  "employee:update",
  "employee:deactivate",
  "employee:reactivate",
  "employee:archive",
  "employee:export",
  "credential:issue",
  "credential:read",
  "credential:revoke",
  "audit:read",
  "audit:read:security",
  "dashboard:read",
  "users:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "OWNER" | "HR_ADMIN" | "HR_STAFF";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  HR_ADMIN: "HR Administrator",
  HR_STAFF: "HR Staff",
};

const HR_ADMIN: Permission[] = [
  "employee:read",
  "employee:create",
  "employee:update",
  "employee:deactivate",
  "employee:reactivate",
  "employee:archive",
  "employee:export",
  "credential:issue",
  "credential:read",
  "credential:revoke",
  "audit:read",
  "dashboard:read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  HR_ADMIN,
  // HR staff: read-only by default; owner may grant create/update/credential perms individually.
  HR_STAFF: ["employee:read", "credential:read", "dashboard:read"],
};

/** Permissions that may be granted to individual users on top of their role. */
export const GRANTABLE: Permission[] = [
  "employee:create",
  "employee:update",
  "employee:deactivate",
  "employee:reactivate",
  "credential:issue",
  "credential:revoke",
  "employee:export",
  "audit:read",
];

export interface Principal {
  id: string;
  role: Role;
  extraPermissions?: readonly string[];
}

function isPermission(p: string): p is Permission {
  return (PERMISSIONS as readonly string[]).includes(p);
}

export function permissionsFor(user: Principal): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[user.role] ?? []);
  for (const p of user.extraPermissions ?? []) {
    if (isPermission(p) && GRANTABLE.includes(p)) set.add(p);
  }
  return set;
}

export function can(user: Principal | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return permissionsFor(user).has(permission);
}

export function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "HR_ADMIN";
}
