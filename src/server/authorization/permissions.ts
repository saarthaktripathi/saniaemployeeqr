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
  "employee:delete",
  "employee:export",
  "credential:issue",
  "credential:read",
  "credential:revoke",
  "document:read",
  "document:manage",
  "compensation:read",
  "compensation:manage",
  "company:manage",
  "attendance:read",
  "attendance:manage",
  "task:read",
  "task:manage",
  "leave:read",
  "leave:manage",
  "policy:manage",
  "account:manage",
  "announcement:send",
  "audit:read",
  "audit:read:security",
  "dashboard:read",
  "users:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "OWNER" | "HR_ADMIN" | "HR_STAFF" | "MANAGEMENT" | "TEAM_MANAGER" | "EMPLOYEE";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  HR_ADMIN: "HR Administrator",
  HR_STAFF: "HR Staff",
  MANAGEMENT: "Management",
  TEAM_MANAGER: "Team Manager",
  EMPLOYEE: "Employee",
};

/** Roles that only use the employee workspace (/me) and never the HR console. */
export const WORKSPACE_ROLES = ["TEAM_MANAGER", "EMPLOYEE"] as const satisfies readonly Role[];
/** Roles HR administrators may give through invitations (owners manage every other role). */
export const INVITABLE_ROLES = WORKSPACE_ROLES;

export function isWorkspaceRole(role: Role): boolean {
  return (WORKSPACE_ROLES as readonly Role[]).includes(role);
}

const HR_ADMIN: Permission[] = [
  "employee:read",
  "employee:create",
  "employee:update",
  "employee:deactivate",
  "employee:reactivate",
  "employee:archive",
  "employee:delete",
  "employee:export",
  "credential:issue",
  "credential:read",
  "credential:revoke",
  "document:read",
  "document:manage",
  "attendance:read",
  "attendance:manage",
  "task:read",
  "task:manage",
  "leave:read",
  "leave:manage",
  "policy:manage",
  "account:manage",
  "announcement:send",
  "audit:read",
  "dashboard:read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  HR_ADMIN,
  // HR staff: read-only by default; owner may grant create/update/credential perms individually.
  HR_STAFF: ["employee:read", "credential:read", "dashboard:read", "attendance:read", "task:read", "leave:read"],
  // Leadership: read-only view of the whole group. Salary and documents only if granted.
  MANAGEMENT: ["employee:read", "credential:read", "dashboard:read", "audit:read", "attendance:read", "task:read", "leave:read"],
  // Workspace roles have no organisation-wide permissions. Their self-service access comes from
  // the linked employee record, and a team manager's from their reporting tree (see services).
  TEAM_MANAGER: [],
  EMPLOYEE: [],
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
  "document:read",
  "document:manage",
  "compensation:read",
  "compensation:manage",
  "company:manage",
  "attendance:read",
  "attendance:manage",
  "task:read",
  "task:manage",
  "leave:read",
  "leave:manage",
  "account:manage",
  "announcement:send",
];

/** Plain-language names for the Users & Access screen. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "employee:read": "View employees",
  "employee:create": "Add employees",
  "employee:update": "Edit employees",
  "employee:deactivate": "Deactivate / record exit",
  "employee:reactivate": "Reactivate employees",
  "employee:archive": "Archive employees",
  "employee:delete": "Delete employees",
  "employee:export": "Export directory (CSV)",
  "credential:issue": "Issue QR credentials",
  "credential:read": "View QR credentials & ID cards",
  "credential:revoke": "Revoke QR credentials",
  "document:read": "View employee documents",
  "document:manage": "Upload / delete documents",
  "compensation:read": "View salary & compensation",
  "compensation:manage": "Edit salary & compensation",
  "company:manage": "Manage group companies",
  "attendance:read": "View all attendance",
  "attendance:manage": "Correct attendance",
  "task:read": "View all tasks",
  "task:manage": "Assign & manage tasks",
  "leave:read": "View all leave",
  "leave:manage": "Approve leave",
  "policy:manage": "Attendance & leave policies",
  "account:manage": "Employee logins & invitations",
  "announcement:send": "Send announcements",
  "audit:read": "View activity log",
  "audit:read:security": "View security activity",
  "dashboard:read": "View dashboard",
  "users:manage": "Manage users",
  "settings:manage": "Manage system rules",
};

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
  // Workspace logins never hold organisation-wide permissions, whatever is stored on the account.
  if (isWorkspaceRole(user.role)) return set;
  for (const p of user.extraPermissions ?? []) {
    if (isPermission(p) && GRANTABLE.includes(p)) set.add(p);
  }
  return set;
}

export function can(user: Principal | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return permissionsFor(user).has(permission);
}

/**
 * Comma-separated RLS scopes (app.scopes) for an actor: organisation-wide read/manage rights
 * that the database policies honour. Self and team access need no scope.
 */
export function rlsScopes(user: Principal): string {
  const map: [Permission, string][] = [
    ["employee:read", "employee"],
    ["attendance:read", "attendance"],
    ["attendance:manage", "attendance,attendance_manage"],
    ["task:read", "task"],
    ["task:manage", "task,task_manage"],
    ["leave:read", "leave"],
    ["leave:manage", "leave,leave_manage"],
    ["policy:manage", "policy_manage"],
  ];
  // A manage scope implies the matching read scope.
  return [...new Set(map.filter(([p]) => can(user, p)).flatMap(([, s]) => s.split(",")))].join(",");
}

export function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "HR_ADMIN";
}

/** Grants that expose especially sensitive data; holders are treated as privileged for MFA. */
const SENSITIVE_GRANTS: Permission[] = ["compensation:read", "compensation:manage", "document:read", "document:manage"];

/** Whether the "Require MFA" policy applies: privileged roles, or anyone granted salary/document access. */
export function requiresMfa(user: Principal): boolean {
  return isPrivileged(user.role) || SENSITIVE_GRANTS.some((p) => can(user, p));
}
