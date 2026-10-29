import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  bulkChangeStatus,
  changeEmployeeStatus,
  createEmployee,
  exportEmployeesCsv,
  getEmployee,
  importEmployeesCsv,
  listEmployees,
  updateEmployee,
} from "@/server/services/employees";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

const year = new Date().getUTCFullYear();

beforeEach(resetDb);

describe("employee creation", () => {
  it("persists the record, assigns a sequential code, audits and emits an event", async () => {
    const owner = await makeUser("OWNER");
    const a = await createEmployee(db, owner, baseEmployee, ctx);
    const b = await createEmployee(db, owner, { ...baseEmployee, firstName: "Kabir" }, ctx);
    expect(a.employeeCode).toBe(`SJB-${year}-001`);
    expect(b.employeeCode).toBe(`SJB-${year}-002`);

    const stored = await db.employee.findUniqueOrThrow({ where: { id: a.id } });
    expect(stored).toMatchObject({ displayName: "Asha Verma", employmentStatus: "ACTIVE", createdById: owner.id, version: 1 });
    // Default ID validity: issued today, +365 days.
    expect(Math.round((stored.idExpiresAt.getTime() - stored.idIssueDate.getTime()) / 86_400_000)).toBe(365);

    const audit = await db.auditLog.findMany({ where: { targetId: a.id } });
    expect(audit.map((x) => x.action)).toEqual(["employee.created"]);
    const events = await db.outboxEvent.findMany({ where: { type: "employee.created" } });
    expect(events).toHaveLength(2);
    // Events carry identifiers only — no personal data.
    expect(JSON.stringify(events[0].payload)).not.toContain("Asha");
  });

  it("generates unique codes under concurrent creation", async () => {
    const owner = await makeUser("OWNER");
    const N = 40;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => createEmployee(db, owner, { ...baseEmployee, firstName: `Concurrent${i}` }, ctx)),
    );
    const codes = results.map((r) => r.employeeCode);
    expect(new Set(codes).size).toBe(N);
    const seqs = codes.map((c) => Number(c.split("-")[2])).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("never reuses a code after a rolled-back transaction", async () => {
    const owner = await makeUser("OWNER");
    await createEmployee(db, owner, { ...baseEmployee, workEmail: "dup@example.com" }, ctx);
    await expect(createEmployee(db, owner, { ...baseEmployee, workEmail: "DUP@example.com" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await createEmployee(db, owner, baseEmployee, ctx);
    // The failed attempt rolled back its counter increment: no gap, no duplicate.
    expect(next.employeeCode).toBe(`SJB-${year}-002`);
    expect(await db.employee.count()).toBe(2);
  });

  it("uses the configured prefix", async () => {
    const owner = await makeUser("OWNER");
    await db.companySettings.update({ where: { id: 1 }, data: { employeeIdPrefix: "SANIA" } });
    expect((await createEmployee(db, owner, baseEmployee, ctx)).employeeCode).toBe(`SANIA-${year}-001`);
  });

  it("denies and audits creation without permission", async () => {
    const staff = await makeUser("HR_STAFF");
    await expect(createEmployee(db, staff, baseEmployee, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.employee.count()).toBe(0);
    const denied = await db.auditLog.findFirstOrThrow({ where: { action: "authz.denied" } });
    expect(denied).toMatchObject({ actorId: staff.id, outcome: "DENIED" });
  });

  it("allows HR staff when the permission is granted individually", async () => {
    const staff = await makeUser("HR_STAFF", ["employee:create"]);
    await expect(createEmployee(db, staff, baseEmployee, ctx)).resolves.toBeTruthy();
  });

  it("rejects invalid payloads", async () => {
    const owner = await makeUser("OWNER");
    await expect(createEmployee(db, owner, { ...baseEmployee, employmentStatus: "INACTIVE" }, ctx)).rejects.toThrow();
    await expect(createEmployee(db, owner, { firstName: "" }, ctx)).rejects.toThrow();
  });
});

describe("employee updates", () => {
  it("applies optimistic concurrency and keeps the employee code", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const input = { ...baseEmployee, jobTitle: "Senior Partner", idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01", version: 1 };
    const updated = await updateEmployee(db, owner, e.id, input, ctx);
    expect(updated).toMatchObject({ jobTitle: "Senior Partner", version: 2, employeeCode: e.employeeCode });

    // A second editor still holding version 1 must not overwrite.
    await expect(updateEmployee(db, owner, e.id, { ...input, jobTitle: "Stale" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "employee.updated" } });
    expect(audit.metadata).toMatchObject({ changed: expect.arrayContaining(["jobTitle", "idIssueDate", "idExpiresAt"]) });
    // Audit stores field names, not values.
    expect(JSON.stringify(audit.metadata)).not.toContain("Senior Partner");
  });

  it("returns NOT_FOUND for unknown ids and blocks edits to archived records", async () => {
    const owner = await makeUser("OWNER");
    const input = { ...baseEmployee, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01", version: 1 };
    await expect(updateEmployee(db, owner, "00000000-0000-4000-8000-000000000000", input, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "left" }, ctx);
    await expect(updateEmployee(db, owner, e.id, { ...input, version: 2 }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("status transitions", () => {
  it("deactivates, reactivates and archives with an audit trail", async () => {
    const admin = await makeUser("HR_ADMIN");
    const e = await createEmployee(db, admin, baseEmployee, ctx);
    await changeEmployeeStatus(db, admin, e.id, { action: "deactivate", reason: "leave" }, ctx);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).employmentStatus).toBe("INACTIVE");
    await expect(changeEmployeeStatus(db, admin, e.id, { action: "deactivate" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await changeEmployeeStatus(db, admin, e.id, { action: "reactivate" }, ctx);
    await changeEmployeeStatus(db, admin, e.id, { action: "archive", reason: "resigned" }, ctx);
    const final = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(final.employmentStatus).toBe("INACTIVE");
    expect(final.archivedAt).not.toBeNull();
    const actions = (await db.auditLog.findMany({ where: { targetId: e.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["employee.created", "employee.deactivated", "employee.reactivated", "employee.archived"]);
  });

  it("bulk-changes status atomically", async () => {
    const owner = await makeUser("OWNER");
    const a = await createEmployee(db, owner, baseEmployee, ctx);
    const b = await createEmployee(db, owner, baseEmployee, ctx);
    const c = await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, owner, c.id, { action: "deactivate" }, ctx);
    // c is already inactive, so the whole batch must roll back.
    await expect(bulkChangeStatus(db, owner, { ids: [a.id, b.id, c.id], action: "deactivate" }, ctx)).rejects.toBeInstanceOf(AppError);
    expect(await db.employee.count({ where: { employmentStatus: "ACTIVE" } })).toBe(2);
    await expect(bulkChangeStatus(db, owner, { ids: [a.id, b.id], action: "deactivate" }, ctx)).resolves.toEqual({ updated: 2 });
    expect(await db.employee.count({ where: { employmentStatus: "INACTIVE" } })).toBe(3);
  });

  it("enforces per-action permissions", async () => {
    const owner = await makeUser("OWNER");
    const staff = await makeUser("HR_STAFF", ["employee:deactivate"]);
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, staff, e.id, { action: "deactivate" }, ctx);
    await expect(changeEmployeeStatus(db, staff, e.id, { action: "reactivate" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("directory queries", () => {
  it("searches, filters, sorts and paginates on the server", async () => {
    const owner = await makeUser("OWNER");
    for (let i = 0; i < 25; i++) {
      await createEmployee(db, owner, { ...baseEmployee, firstName: i % 5 === 0 ? `Zed${i}` : `Person${i}`, department: i % 2 ? "Finance" : "Recruitment" }, ctx);
    }
    const page1 = await listEmployees(db, owner, { pageSize: "10", sort: "code", dir: "asc" }, ctx);
    expect(page1).toMatchObject({ total: 25, pageCount: 3 });
    expect(page1.rows[0].employeeCode).toBe(`SJB-${year}-001`);
    const page3 = await listEmployees(db, owner, { pageSize: "10", page: "3", sort: "code", dir: "asc" }, ctx);
    expect(page3.rows).toHaveLength(5);
    expect(new Set([...page1.rows, ...page3.rows].map((r) => r.id)).size).toBe(15);

    expect((await listEmployees(db, owner, { q: "zed" }, ctx)).total).toBe(5);
    expect((await listEmployees(db, owner, { q: `SJB-${year}-00` }, ctx)).total).toBe(9);
    expect((await listEmployees(db, owner, { department: "finance" }, ctx)).total).toBe(12);
    expect((await listEmployees(db, owner, { credential: "NONE" }, ctx)).total).toBe(25);
    // Wildcards in search input are treated literally.
    expect((await listEmployees(db, owner, { q: "%" }, ctx)).total).toBe(0);
  });

  it("filters by ID expiry", async () => {
    const owner = await makeUser("OWNER");
    const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    await createEmployee(db, owner, { ...baseEmployee, idIssueDate: iso(-400), idExpiresAt: iso(-5) }, ctx);
    await createEmployee(db, owner, { ...baseEmployee, idIssueDate: iso(-300), idExpiresAt: iso(10) }, ctx);
    await createEmployee(db, owner, { ...baseEmployee, idIssueDate: iso(-1), idExpiresAt: iso(200) }, ctx);
    expect((await listEmployees(db, owner, { expiry: "EXPIRED" }, ctx)).total).toBe(1);
    expect((await listEmployees(db, owner, { expiry: "EXPIRING_SOON" }, ctx)).total).toBe(1);
    expect((await listEmployees(db, owner, { expiry: "VALID" }, ctx)).total).toBe(1);
  });

  it("hides archived employees unless requested", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "x" }, ctx);
    expect((await listEmployees(db, owner, {}, ctx)).total).toBe(1);
    expect((await listEmployees(db, owner, { status: "ARCHIVED" }, ctx)).total).toBe(1);
  });

  it("denies reads to principals without employee:read", async () => {
    const staff = await makeUser("HR_STAFF");
    await expect(getEmployee(db, { ...staff, role: "NOBODY" as never }, "00000000-0000-4000-8000-000000000000", ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("import and export", () => {
  it("imports valid CSV atomically and rejects files with any invalid row", async () => {
    const owner = await makeUser("OWNER");
    const bad = "firstName,department,jobTitle\nAsha,Recruitment,Partner\n,Finance,Clerk\n";
    await expect(importEmployeesCsv(db, owner, bad, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { rows: [{ row: 3 }] } });
    expect(await db.employee.count()).toBe(0);

    const good = "firstName,lastName,department,jobTitle,workEmail\nAsha,Verma,Recruitment,Partner,a@x.com\nRavi,,Finance,Clerk,\n";
    await expect(importEmployeesCsv(db, owner, good, ctx)).resolves.toMatchObject({ created: 2 });
    await expect(importEmployeesCsv(db, owner, "firstName,department,jobTitle,salary\nA,B,C,1\n", ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(importEmployeesCsv(db, owner, "firstName,department,jobTitle,workEmail\nB,C,D,A@x.com\n", ctx)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("exports authorized fields with formula injection neutralised", async () => {
    const owner = await makeUser("OWNER");
    await createEmployee(db, owner, { ...baseEmployee, firstName: "=cmd|' /C calc'!A0", phone: "+91 99999 00000" }, ctx);
    const csv = await exportEmployeesCsv(db, owner, {}, ctx);
    expect(csv.split("\r\n")[0]).toContain("employeeCode");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toContain("99999"); // phone is never exported
    const staff = await makeUser("HR_STAFF");
    await expect(exportEmployeesCsv(db, staff, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "employee.exported" } })).toBe(1);
  });
});
