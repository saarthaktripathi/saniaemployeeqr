import { describe, expect, it } from "vitest";
import { can, GRANTABLE, isPrivileged, isWorkspaceRole, PERMISSION_LABELS, PERMISSIONS, permissionsFor, requiresMfa, rlsScopes, type Role } from "@/server/authorization/permissions";

const user = (role: Role, extraPermissions: string[] = []) => ({ id: "u", role, extraPermissions });

describe("permission model", () => {
  it("denies by default for missing users", () => {
    expect(can(null, "employee:read")).toBe(false);
    expect(can(undefined, "employee:read")).toBe(false);
  });

  it("grants every permission to owners", () => {
    for (const p of PERMISSIONS) expect(can(user("OWNER"), p)).toBe(true);
  });

  it("restricts HR administrators from owner-only actions", () => {
    const a = user("HR_ADMIN");
    expect(can(a, "employee:create")).toBe(true);
    expect(can(a, "credential:revoke")).toBe(true);
    expect(can(a, "audit:read")).toBe(true);
    expect(can(a, "users:manage")).toBe(false);
    expect(can(a, "settings:manage")).toBe(false);
    expect(can(a, "audit:read:security")).toBe(false);
  });

  it("makes HR staff read-only by default", () => {
    const s = user("HR_STAFF");
    expect(can(s, "employee:read")).toBe(true);
    expect(can(s, "employee:create")).toBe(false);
    expect(can(s, "employee:deactivate")).toBe(false);
    expect(can(s, "audit:read")).toBe(false);
  });

  it("applies grantable extra permissions only", () => {
    const s = user("HR_STAFF", ["employee:create", "users:manage", "settings:manage", "nonsense"]);
    expect(can(s, "employee:create")).toBe(true);
    // Privileged permissions cannot be granted individually.
    expect(can(s, "users:manage")).toBe(false);
    expect(can(s, "settings:manage")).toBe(false);
    expect([...permissionsFor(s)]).not.toContain("nonsense");
  });

  it("identifies privileged roles", () => {
    expect(isPrivileged("OWNER")).toBe(true);
    expect(isPrivileged("HR_ADMIN")).toBe(true);
    expect(isPrivileged("HR_STAFF")).toBe(false);
    expect(isPrivileged("MANAGEMENT")).toBe(false);
  });
});

describe("directory permissions", () => {
  it("gives management read-only access to the directory, ID cards, dashboard, activity log and workforce data", () => {
    const m = user("MANAGEMENT");
    expect([...permissionsFor(m)].sort()).toEqual(["attendance:read", "audit:read", "credential:read", "dashboard:read", "employee:read", "leave:read", "task:read"]);
    for (const p of ["employee:create", "employee:update", "employee:deactivate", "employee:export", "credential:issue", "document:read", "compensation:read", "company:manage", "users:manage", "attendance:manage", "task:manage", "leave:manage", "account:manage"] as const) {
      expect(can(m, p)).toBe(false);
    }
  });

  it("keeps compensation owner-only by default and documents with HR administrators", () => {
    expect(can(user("OWNER"), "compensation:manage")).toBe(true);
    expect(can(user("OWNER"), "company:manage")).toBe(true);
    const a = user("HR_ADMIN");
    expect(can(a, "document:read")).toBe(true);
    expect(can(a, "document:manage")).toBe(true);
    expect(can(a, "compensation:read")).toBe(false);
    expect(can(a, "company:manage")).toBe(false);
    expect(can(user("HR_STAFF"), "document:read")).toBe(false);
  });

  it("lets the owner grant salary, document and company access individually", () => {
    for (const p of ["compensation:read", "compensation:manage", "document:read", "document:manage", "company:manage"] as const) {
      expect(GRANTABLE).toContain(p);
      expect(can(user("MANAGEMENT", [p]), p)).toBe(true);
      expect(can(user("HR_STAFF", [p]), p)).toBe(true);
    }
    expect(can(user("MANAGEMENT", ["users:manage", "audit:read:security"]), "users:manage")).toBe(false);
  });

  it("requires MFA for privileged roles and for anyone holding salary or document grants", () => {
    expect(requiresMfa(user("OWNER"))).toBe(true);
    expect(requiresMfa(user("HR_ADMIN"))).toBe(true);
    expect(requiresMfa(user("HR_STAFF"))).toBe(false);
    expect(requiresMfa(user("MANAGEMENT"))).toBe(false);
    expect(requiresMfa(user("MANAGEMENT", ["compensation:read"]))).toBe(true);
    expect(requiresMfa(user("HR_STAFF", ["document:read"]))).toBe(true);
    expect(requiresMfa(user("HR_STAFF", ["employee:create"]))).toBe(false);
  });

  it("labels every permission", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
  });

  it("gives workspace roles no organisation-wide permissions, even if granted", () => {
    for (const role of ["EMPLOYEE", "TEAM_MANAGER"] as const) {
      expect(permissionsFor(user(role)).size).toBe(0);
      expect(isWorkspaceRole(role)).toBe(true);
      expect(requiresMfa(user(role))).toBe(false);
    }
    expect(isWorkspaceRole("HR_ADMIN")).toBe(false);
    // Extra grants are honoured only from the grantable list; workspace roles never get users:manage.
    expect(can(user("EMPLOYEE", ["users:manage", "settings:manage", "policy:manage"]), "users:manage")).toBe(false);
    expect(permissionsFor(user("EMPLOYEE", ["attendance:read", "employee:create"])).size).toBe(0);
    expect(permissionsFor(user("TEAM_MANAGER", ["task:manage"])).size).toBe(0);
  });

  it("maps permissions to database RLS scopes (manage implies read)", () => {
    expect(rlsScopes(user("EMPLOYEE"))).toBe("");
    expect(rlsScopes(user("TEAM_MANAGER"))).toBe("");
    const hr = rlsScopes(user("HR_ADMIN")).split(",");
    expect(hr).toEqual(expect.arrayContaining(["employee", "attendance", "attendance_manage", "task", "task_manage", "leave", "leave_manage", "policy_manage"]));
    const staff = rlsScopes(user("HR_STAFF")).split(",");
    expect(staff).toEqual(expect.arrayContaining(["employee", "attendance", "task", "leave"]));
    expect(staff).not.toContain("attendance_manage");
    expect(rlsScopes(user("HR_STAFF", ["leave:manage"])).split(",")).toEqual(expect.arrayContaining(["leave", "leave_manage"]));
  });

  it("keeps HR administrators away from user management and policies stay with HR admins/owners", () => {
    expect(can(user("HR_ADMIN"), "users:manage")).toBe(false);
    expect(can(user("HR_ADMIN"), "account:manage")).toBe(true);
    expect(can(user("HR_ADMIN"), "policy:manage")).toBe(true);
    expect(can(user("HR_STAFF", ["policy:manage"]), "policy:manage")).toBe(false); // not grantable
    expect(can(user("MANAGEMENT"), "attendance:read")).toBe(true);
    expect(can(user("MANAGEMENT"), "attendance:manage")).toBe(false);
  });
});
