import { describe, expect, it } from "vitest";
import { bulkStatusSchema, employeeCreateSchema, employeeListQuerySchema, employeeUpdateSchema } from "@/features/employees/schema";
import { settingsUpdateSchema } from "@/features/settings/schema";
import { userCreateSchema } from "@/features/users/schema";

const valid = { firstName: "Asha", department: "Recruitment", jobTitle: "Talent Partner" };

describe("employeeCreateSchema", () => {
  it("accepts a minimal record and normalises optional fields", () => {
    const r = employeeCreateSchema.parse(valid);
    expect(r).toMatchObject({ firstName: "Asha", lastName: "", workEmail: null, phone: null, joiningDate: null, idIssueDate: null });
  });

  it("trims, lowercases email and parses dates", () => {
    const r = employeeCreateSchema.parse({ ...valid, firstName: "  Asha ", workEmail: " Asha@Example.COM ", joiningDate: "2026-02-28" });
    expect(r.firstName).toBe("Asha");
    expect(r.workEmail).toBe("asha@example.com");
    expect(r.joiningDate?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("rejects unknown keys (mass assignment)", () => {
    for (const key of ["employmentStatus", "employeeCode", "id", "archivedAt", "createdById", "version"]) {
      expect(employeeCreateSchema.safeParse({ ...valid, [key]: "x" }).success).toBe(false);
    }
  });

  it("rejects missing required fields, oversize input and control characters", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, department: "x".repeat(81) }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, firstName: "A\u0000b" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, jobTitle: "line\nbreak" }).success).toBe(false);
  });

  it("rejects invalid dates and reversed ranges", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, joiningDate: "2026-02-30" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, joiningDate: "15/02/2026" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, idIssueDate: "2026-05-01", idExpiresAt: "2026-04-01" }).success).toBe(false);
  });

  it("keeps HTML as inert text (escaping happens at render)", () => {
    const r = employeeCreateSchema.parse({ ...valid, firstName: "<script>alert(1)</script>" });
    expect(r.firstName).toBe("<script>alert(1)</script>");
  });

  it("validates email and phone formats", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, workEmail: "not-an-email" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, phone: "+91 98765 43210" }).success).toBe(true);
  });
});

describe("employeeUpdateSchema", () => {
  it("requires a version and both ID dates", () => {
    expect(employeeUpdateSchema.safeParse({ ...valid, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01" }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ ...valid, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01", version: 1 }).success).toBe(true);
  });
});

describe("employeeListQuerySchema", () => {
  it("applies defaults and bounds", () => {
    expect(employeeListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, status: "ALL", sort: "createdAt", dir: "desc" });
    expect(employeeListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ sort: "password" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("bounds bulk operations", () => {
    expect(bulkStatusSchema.safeParse({ ids: [], action: "deactivate" }).success).toBe(false);
    const ids = Array.from({ length: 201 }, () => "00000000-0000-4000-8000-000000000000");
    expect(bulkStatusSchema.safeParse({ ids, action: "deactivate" }).success).toBe(false);
  });
  it("validates settings", () => {
    expect(settingsUpdateSchema.safeParse({ employeeIdPrefix: "sjb" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ employeeIdPrefix: "SJB" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ auditRetentionDays: 10 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ unknown: true }).success).toBe(false);
  });
  it("enforces password length for new users", () => {
    expect(userCreateSchema.safeParse({ name: "A", email: "a@b.co", role: "HR_STAFF", password: "short" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ name: "A", email: "a@b.co", role: "HR_STAFF", password: "long-enough-pass" }).success).toBe(true);
  });
});
