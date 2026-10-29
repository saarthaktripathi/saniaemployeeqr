import { describe, expect, it } from "vitest";
import { can, isPrivileged, PERMISSIONS, permissionsFor } from "@/server/authorization/permissions";

const user = (role: "OWNER" | "HR_ADMIN" | "HR_STAFF", extraPermissions: string[] = []) => ({ id: "u", role, extraPermissions });

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
  });
});
