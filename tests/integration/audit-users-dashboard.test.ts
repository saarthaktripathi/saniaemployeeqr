import { beforeEach, describe, expect, it } from "vitest";
import { recordAudit } from "@/server/services/audit";
import { listAudit } from "@/server/services/audit-read";
import { createUser, updateUser } from "@/server/services/users";
import { getDashboardStats } from "@/server/services/dashboard";
import { getSettings, updateSettings } from "@/server/services/settings";
import { createEmployee, changeEmployeeStatus } from "@/server/services/employees";
import { issueCredential } from "@/server/services/credentials";
import { verifyPassword } from "@/server/auth/password";
import { baseEmployee, ctx, db, makeUser, resetDb } from "../support/db";

beforeEach(resetDb);

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const owner = await makeUser("OWNER");
    await recordAudit(db, ctx, { actor: owner, action: "employee.created" });
    await expect(db.auditLog.updateMany({ data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("allows retention purges only with an explicit per-transaction opt-in", async () => {
    const owner = await makeUser("OWNER");
    await recordAudit(db, ctx, { actor: owner, action: "employee.created" });
    const purged = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.audit_purge = 'on'`;
      return tx.auditLog.deleteMany({});
    });
    expect(purged.count).toBe(1);
    // The opt-in does not leak into later transactions.
    await recordAudit(db, ctx, { actor: owner, action: "employee.created" });
    await expect(db.auditLog.deleteMany({})).rejects.toThrow();
  });

  it("hides security events from HR administrators and paginates by cursor", async () => {
    const owner = await makeUser("OWNER");
    const admin = await makeUser("HR_ADMIN");
    for (let i = 0; i < 5; i++) await recordAudit(db, ctx, { actor: owner, action: "employee.updated" });
    await recordAudit(db, ctx, { actor: owner, action: "auth.login.success" });
    await recordAudit(db, ctx, { actor: owner, action: "settings.updated" });

    const forAdmin = await listAudit(db, admin, { limit: 50 }, ctx);
    expect(forAdmin.rows.every((r) => !r.action.startsWith("auth.") && !r.action.startsWith("settings."))).toBe(true);
    const forOwner = await listAudit(db, owner, { limit: 50 }, ctx);
    expect(forOwner.rows.map((r) => r.action)).toContain("auth.login.success");

    const p1 = await listAudit(db, owner, { limit: 3 }, ctx);
    expect(p1.rows).toHaveLength(3);
    const p2 = await listAudit(db, owner, { limit: 3, cursor: p1.nextCursor }, ctx);
    expect(p2.rows.map((r) => r.id)).not.toContain(p1.rows[2].id);
    expect(BigInt(p2.rows[0].id)).toBeLessThan(BigInt(p1.rows[2].id));

    const staff = await makeUser("HR_STAFF");
    await expect(listAudit(db, staff, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rolls back audit entries and events with the failed change", async () => {
    const owner = await makeUser("OWNER");
    await expect(
      db.$transaction(async (tx) => {
        await recordAudit(tx, ctx, { actor: owner, action: "employee.created" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(0);
  });
});

describe("user management", () => {
  it("creates users with Argon2id hashes and blocks duplicates", async () => {
    const owner = await makeUser("OWNER");
    const u = await createUser(db, owner, { name: "New HR", email: "New.HR@test.local", role: "HR_STAFF", password: "a-strong-password", extraPermissions: [] }, ctx);
    expect(u.email).toBe("new.hr@test.local");
    const acct = await db.account.findFirstOrThrow({ where: { userId: u.id } });
    expect(acct.password).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword({ hash: acct.password!, password: "a-strong-password" })).toBe(true);
    expect(await verifyPassword({ hash: acct.password!, password: "wrong" })).toBe(false);
    await expect(createUser(db, owner, { name: "x", email: "new.hr@test.local", role: "HR_STAFF", password: "a-strong-password" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("only owners can manage users", async () => {
    const admin = await makeUser("HR_ADMIN");
    await expect(createUser(db, admin, { name: "x", email: "x@test.local", role: "OWNER", password: "a-strong-password" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("protects the last owner and revokes sessions on changes", async () => {
    const owner = await makeUser("OWNER");
    await expect(updateUser(db, owner, owner.id, { role: "HR_ADMIN" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const other = await makeUser("OWNER");
    await expect(updateUser(db, other, owner.id, { isActive: false }, ctx)).resolves.toBeTruthy();
    await expect(updateUser(db, other, other.id, { isActive: false }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const staff = await makeUser("HR_STAFF");
    await db.session.create({ data: { id: "s1", token: "t1", userId: staff.id, expiresAt: new Date(Date.now() + 1e6) } });
    await updateUser(db, other, staff.id, { extraPermissions: ["employee:create"] }, ctx);
    expect(await db.session.count({ where: { userId: staff.id } })).toBe(0);
  });
});

describe("dashboard metrics and settings", () => {
  it("computes counts from the database", async () => {
    const owner = await makeUser("OWNER");
    const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const a = await createEmployee(db, owner, baseEmployee, ctx);
    const b = await createEmployee(db, owner, { ...baseEmployee, department: "Finance", idIssueDate: iso(-400), idExpiresAt: iso(-1) }, ctx);
    const c = await createEmployee(db, owner, { ...baseEmployee, idIssueDate: iso(-300), idExpiresAt: iso(5) }, ctx);
    const d = await createEmployee(db, owner, baseEmployee, ctx);
    await issueCredential(db, owner, a.id, ctx);
    await issueCredential(db, owner, b.id, ctx);
    await changeEmployeeStatus(db, owner, c.id, { action: "deactivate" }, ctx);
    await issueCredential(db, owner, d.id, ctx);
    await changeEmployeeStatus(db, owner, d.id, { action: "archive", reason: "x" }, ctx);

    const s = await getDashboardStats(db, owner, ctx);
    expect(s).toMatchObject({ totalRecords: 3, active: 2, inactive: 1, archived: 1, expiredIds: 1, expiringSoon: 1, validCredentials: 2 });
    expect(s.departments.find((x) => x.department === "Recruitment")?.count).toBe(2);
  });

  it("restricts settings to owners and audits changes", async () => {
    const owner = await makeUser("OWNER");
    const admin = await makeUser("HR_ADMIN");
    await expect(updateSettings(db, admin, { expiryWarningDays: 10 }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateSettings(db, owner, { expiryWarningDays: 10, employeeIdPrefix: "SJX" }, ctx);
    expect((await getSettings(db)).expiryWarningDays).toBe(10);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "settings.updated" } });
    expect(audit.metadata).toMatchObject({ changed: expect.arrayContaining(["expiryWarningDays", "employeeIdPrefix"]) });
  });
});
