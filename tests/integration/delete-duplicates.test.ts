import { beforeEach, describe, expect, it } from "vitest";
import { createEmployee, deleteEmployees, findDuplicateEmployees, importEmployeesCsv } from "@/server/services/employees";
import { issueCredential } from "@/server/services/credentials";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

const year = new Date().getUTCFullYear();
const CSV = "firstName,lastName,department,jobTitle\r\nAsha,Verma,Recruitment,Talent Partner\r\nKabir,Rao,Sales,Account Lead\r\n";

beforeEach(resetDb);

describe("employee deletion", () => {
  it("deletes one employee with its credentials, audits it and never reuses the code", async () => {
    const owner = await makeUser("OWNER");
    const a = await createEmployee(db, owner, baseEmployee, ctx);
    await issueCredential(db, owner, a.id, ctx);
    await expect(deleteEmployees(db, owner, { ids: [a.id], reason: "Entered by mistake" }, ctx)).resolves.toEqual({ deleted: 1 });

    expect(await db.employee.count()).toBe(0);
    expect(await db.employeeCredential.count()).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "employee.deleted" } });
    expect(audit).toMatchObject({ targetId: a.id, actorId: owner.id });
    expect(audit.metadata).toMatchObject({ employeeCode: a.employeeCode, reason: "Entered by mistake" });

    const next = await createEmployee(db, owner, baseEmployee, ctx);
    expect(next.employeeCode).toBe(`SJB-${year}-002`);
  });

  it("deletes many employees atomically", async () => {
    const owner = await makeUser("OWNER");
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await createEmployee(db, owner, { ...baseEmployee, firstName: `E${i}` }, ctx)).id);
    // An unknown id rolls back the whole request.
    await expect(deleteEmployees(db, owner, { ids: [...ids, crypto.randomUUID()], reason: "x" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.employee.count()).toBe(3);
    await expect(deleteEmployees(db, owner, { ids, reason: "Cleanup" }, ctx)).resolves.toEqual({ deleted: 3 });
    expect(await db.employee.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "employee.bulk_deleted" } })).toBe(1);
  });

  it("requires a reason and the delete permission", async () => {
    const owner = await makeUser("OWNER");
    const staff = await makeUser("HR_STAFF", ["employee:create", "employee:update"]);
    const a = await createEmployee(db, owner, baseEmployee, ctx);
    await expect(deleteEmployees(db, owner, { ids: [a.id], reason: "" }, ctx)).rejects.toThrow();
    await expect(deleteEmployees(db, staff, { ids: [a.id], reason: "x" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = await makeUser("HR_ADMIN");
    await expect(deleteEmployees(db, admin, { ids: [a.id], reason: "x" }, ctx)).resolves.toEqual({ deleted: 1 });
  });
});

describe("duplicate detection and cleanup", () => {
  it("finds a CSV imported twice and keeps the record that has a QR credential", async () => {
    const owner = await makeUser("OWNER");
    const first = await importEmployeesCsv(db, owner, CSV, ctx);
    const second = await importEmployeesCsv(db, owner, CSV, ctx);
    expect(first.created + second.created).toBe(4);

    // Issue a QR to the *second* Asha: that copy should be the one kept.
    const secondAsha = await db.employee.findUniqueOrThrow({ where: { employeeCode: second.codes[0] } });
    await issueCredential(db, owner, secondAsha.id, ctx);

    const { groups, extraCount } = await findDuplicateEmployees(db, owner, ctx);
    expect(groups).toHaveLength(2);
    expect(extraCount).toBe(2);
    const asha = groups.find((g) => g.displayName === "Asha Verma")!;
    expect(asha.keep.id).toBe(secondAsha.id);
    expect(asha.extras.map((m) => m.employeeCode)).toEqual([first.codes[0]]);

    await deleteEmployees(db, owner, { ids: groups.flatMap((g) => g.extras.map((m) => m.id)), reason: "Duplicate import" }, ctx);
    expect(await db.employee.count()).toBe(2);
    expect((await findDuplicateEmployees(db, owner, ctx)).groups).toHaveLength(0);
  });

  it("does not treat different people with the same name as duplicates", async () => {
    const owner = await makeUser("OWNER");
    await createEmployee(db, owner, baseEmployee, ctx);
    await createEmployee(db, owner, { ...baseEmployee, workLocation: "Pune" }, ctx);
    expect((await findDuplicateEmployees(db, owner, ctx)).groups).toHaveLength(0);
  });

  it("skips rows that already exist when importing with skipDuplicates", async () => {
    const owner = await makeUser("OWNER");
    await importEmployeesCsv(db, owner, CSV, ctx);
    const again = await importEmployeesCsv(db, owner, CSV + "Meera,Iyer,Sales,Analyst\r\nMeera,Iyer,Sales,Analyst\r\n", ctx, { skipDuplicates: true });
    expect(again).toMatchObject({ created: 1, skipped: 3 });
    expect(await db.employee.count()).toBe(3);
  });
});
