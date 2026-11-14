import { describe, expect, it } from "vitest";
import { can, GRANTABLE, isPrivileged, PERMISSION_LABELS, PERMISSIONS, permissionsFor, requiresMfa, type Role } from "@/server/authorization/permissions";

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
  it("gives management read-only access to the directory, ID cards, dashboard and activity log", () => {
    const m = user("MANAGEMENT");
    expect([...permissionsFor(m)].sort()).toEqual(["audit:read", "credential:read", "dashboard:read", "employee:read"]);
    for (const p of ["employee:create", "employee:update", "employee:deactivate", "employee:export", "credential:issue", "document:read", "compensation:read", "company:manage", "users:manage"] as const) {
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
});
