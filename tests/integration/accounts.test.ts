import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  completePasswordReset,
  createInvitation,
  createPasswordResetLink,
  getEmployeeAccount,
  inspectInvitation,
  inspectPasswordReset,
  listEmployeeAccounts,
  revokeInvitation,
  updateEmployeeAccount,
} from "@/server/services/accounts";
import { recordExit } from "@/server/services/employees";
import { updateUser } from "@/server/services/users";
import { accountAllowsAccess } from "@/server/auth/access";
import { verifyPassword } from "@/server/auth/password";
import { withRls } from "@/server/db/rls";
import { ctx, db, makeEmployee, makeEmployeeUser, makeUser, resetDb } from "../support/db";

beforeEach(resetDb);

const tokenOf = (link: string) => link.split("/").pop()!;
const PASSWORD = "correct horse battery staple";
let ip = 0;
const client = () => ({ requestId: "public", ipHash: `acct-ip-${++ip}` });

describe("employee invitations", () => {
  it("links the new login to the existing employee record (no new employee)", async () => {
    const hr = await makeUser("HR_ADMIN");
    const employeeId = await makeEmployee({ firstName: "Ravi", lastName: "Kumar" });
    const before = await db.employee.count();

    const invite = await createInvitation(db, hr, { employeeId, email: "Ravi.K@Example.com", role: "EMPLOYEE" }, ctx);
    expect(invite.link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const stored = await db.accountToken.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.tokenHash).not.toContain(tokenOf(invite.link)); // only the hash is stored

    expect(await inspectInvitation(db, tokenOf(invite.link))).toMatchObject({ name: "Ravi Kumar", email: "ravi.k@example.com" });
    await acceptInvitation(db, tokenOf(invite.link), { password: PASSWORD, confirmPassword: PASSWORD }, client());

    const user = await db.user.findUniqueOrThrow({ where: { email: "ravi.k@example.com" }, include: { accounts: true } });
    expect(user).toMatchObject({ role: "EMPLOYEE", employeeId, name: "Ravi Kumar" });
    expect(await verifyPassword({ hash: user.accounts[0]!.password!, password: PASSWORD })).toBe(true);
    expect(await db.employee.count()).toBe(before);

    // Single use.
    expect(await inspectInvitation(db, tokenOf(invite.link))).toBeNull();
    await expect(acceptInvitation(db, tokenOf(invite.link), { password: PASSWORD, confirmPassword: PASSWORD }, client())).rejects.toMatchObject({ code: "INVALID_STATE" });
    // One login per employee.
    await expect(createInvitation(db, hr, { employeeId, email: "other@example.com" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

    const actions = (await db.auditLog.findMany({ where: { action: { startsWith: "account." } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["account.invited", "account.invite_accepted"]));
  });

  it("replaces earlier links, supports revoking, and rejects bad input", async () => {
    const hr = await makeUser("HR_ADMIN");
    const employeeId = await makeEmployee();
    const first = await createInvitation(db, hr, { employeeId, email: "a@example.com" }, ctx);
    const second = await createInvitation(db, hr, { employeeId, email: "a@example.com", role: "TEAM_MANAGER" }, ctx);
    expect(await inspectInvitation(db, tokenOf(first.link))).toBeNull();
    expect(await inspectInvitation(db, tokenOf(second.link))).not.toBeNull();
    expect((await getEmployeeAccount(db, hr, employeeId, ctx)).invite).toMatchObject({ role: "TEAM_MANAGER" });

    await revokeInvitation(db, hr, second.id, ctx);
    expect(await inspectInvitation(db, tokenOf(second.link))).toBeNull();
    await expect(revokeInvitation(db, hr, second.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Roles beyond employee/team manager cannot be handed out by invitation (mass assignment).
    await expect(createInvitation(db, hr, { employeeId, email: "a@example.com", role: "OWNER" }, ctx)).rejects.toThrow();
    await expect(createInvitation(db, hr, { employeeId, email: "a@example.com", extra: 1 }, ctx)).rejects.toThrow();
    // Email already used by another login.
    const taken = await makeUser("HR_STAFF");
    await expect(createInvitation(db, hr, { employeeId, email: taken.email }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    // Malformed tokens reveal nothing.
    expect(await inspectInvitation(db, "not-a-token")).toBeNull();
    await expect(acceptInvitation(db, "x".repeat(43), { password: PASSWORD, confirmPassword: PASSWORD }, client())).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses inactive employees, mismatched passwords and unauthorised callers", async () => {
    const hr = await makeUser("HR_ADMIN");
    const staff = await makeUser("HR_STAFF");
    const employee = await makeEmployeeUser("EMPLOYEE", await makeEmployee());
    const employeeId = await makeEmployee({ firstName: "Leaving" });
    await expect(createInvitation(db, staff, { employeeId, email: "x@example.com" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createInvitation(db, employee, { employeeId, email: "x@example.com" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listEmployeeAccounts(db, staff, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const invite = await createInvitation(db, hr, { employeeId, email: "x@example.com" }, ctx);
    await expect(acceptInvitation(db, tokenOf(invite.link), { password: PASSWORD, confirmPassword: "different password!" }, client())).rejects.toThrow();
    await expect(acceptInvitation(db, tokenOf(invite.link), { password: "short", confirmPassword: "short" }, client())).rejects.toThrow();

    // The employee exits before accepting: the link no longer works.
    await recordExit(db, hr, employeeId, { exitDate: new Date().toISOString().slice(0, 10), exitType: "RESIGNATION" }, ctx);
    expect(await inspectInvitation(db, tokenOf(invite.link))).toBeNull();
    await expect(createInvitation(db, hr, { employeeId, email: "y@example.com" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("lists employees by login state", async () => {
    const hr = await makeUser("HR_ADMIN");
    const a = await makeEmployee({ firstName: "Alpha" });
    const b = await makeEmployee({ firstName: "Bravo" });
    await makeEmployee({ firstName: "Charlie" });
    await createInvitation(db, hr, { employeeId: a, email: "alpha@example.com" }, ctx);
    await makeEmployeeUser("EMPLOYEE", b);
    const all = await listEmployeeAccounts(db, hr, {}, ctx);
    expect(all.counts).toEqual({ none: 1, invited: 1, active: 1, disabled: 0 });
    const invited = await listEmployeeAccounts(db, hr, { state: "invited" }, ctx);
    expect(invited.items.map((r) => r.displayName)).toEqual(["Alpha Verma"]);
    expect((await listEmployeeAccounts(db, hr, { q: "brav" }, ctx)).items[0]).toMatchObject({ state: "active" });
  });
});

describe("password reset links", () => {
  it("lets HR reset an employee login once and signs it out everywhere", async () => {
    const hr = await makeUser("HR_ADMIN");
    const emp = await makeEmployeeUser("EMPLOYEE", await makeEmployee());
    await db.session.create({ data: { id: "s1", token: "t1", userId: emp.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const reset = await createPasswordResetLink(db, hr, emp.id, ctx);
    expect(await inspectPasswordReset(db, tokenOf(reset.link))).toMatchObject({ email: emp.email });
    await completePasswordReset(db, tokenOf(reset.link), { password: PASSWORD, confirmPassword: PASSWORD }, client());
    expect(await db.session.count({ where: { userId: emp.id } })).toBe(0);
    await expect(completePasswordReset(db, tokenOf(reset.link), { password: PASSWORD, confirmPassword: PASSWORD }, client())).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await db.auditLog.count({ where: { action: "account.password_reset", targetId: emp.id } })).toBe(1);
  });

  it("keeps HR administrators away from owner and HR accounts", async () => {
    const hr = await makeUser("HR_ADMIN");
    const owner = await makeUser("OWNER");
    const otherHr = await makeUser("HR_STAFF");
    await expect(createPasswordResetLink(db, hr, owner.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPasswordResetLink(db, hr, otherHr.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateEmployeeAccount(db, hr, owner.id, { isActive: false }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Owners can reset HR accounts (users:manage).
    expect((await createPasswordResetLink(db, owner, otherHr.id, ctx)).link).toContain("/reset-password/");
  });
});

describe("employee login state", () => {
  it("deactivation, role change and employee exit all cut access", async () => {
    const hr = await makeUser("HR_ADMIN");
    const employeeId = await makeEmployee();
    const emp = await makeEmployeeUser("EMPLOYEE", employeeId);
    await db.session.create({ data: { id: "s2", token: "t2", userId: emp.id, expiresAt: new Date(Date.now() + 3600_000) } });

    const promoted = await updateEmployeeAccount(db, hr, emp.id, { role: "TEAM_MANAGER" }, ctx);
    expect(promoted.role).toBe("TEAM_MANAGER");
    expect(await db.session.count({ where: { userId: emp.id } })).toBe(0);
    await expect(updateEmployeeAccount(db, hr, emp.id, { role: "HR_ADMIN" }, ctx)).rejects.toThrow();

    await updateEmployeeAccount(db, hr, emp.id, { isActive: false }, ctx);
    const load = () => db.user.findUniqueOrThrow({ where: { id: emp.id }, select: { isActive: true, role: true, employee: { select: { employmentStatus: true, archivedAt: true } } } });
    expect(accountAllowsAccess(await load())).toBe(false);
    await updateEmployeeAccount(db, hr, emp.id, { isActive: true }, ctx);
    expect(accountAllowsAccess(await load())).toBe(true);

    await recordExit(db, hr, employeeId, { exitDate: new Date().toISOString().slice(0, 10), exitType: "RESIGNATION" }, ctx);
    expect(accountAllowsAccess(await load())).toBe(false);
  });

  it("owners can link an HR account to its own employee record, once", async () => {
    const owner = await makeUser("OWNER");
    const hr = await makeUser("HR_ADMIN");
    const employeeId = await makeEmployee();
    await updateUser(db, owner, hr.id, { employeeId }, ctx);
    expect((await db.user.findUniqueOrThrow({ where: { id: hr.id } })).employeeId).toBe(employeeId);
    const other = await makeUser("HR_STAFF");
    await expect(updateUser(db, owner, other.id, { employeeId }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    // Workspace roles must stay linked.
    await expect(updateUser(db, owner, other.id, { role: "EMPLOYEE" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("row-level security (database layer)", () => {
  it("limits employee rows to self (+ own managers), the reporting tree for managers, and everyone for HR", async () => {
    const boss = await makeEmployee({ firstName: "Boss" });
    const lead = await makeEmployee({ firstName: "Lead", reportingManagerId: boss });
    const dev = await makeEmployee({ firstName: "Dev", reportingManagerId: lead });
    const outsider = await makeEmployee({ firstName: "Outsider" });

    const devUser = await makeEmployeeUser("EMPLOYEE", dev);
    const bossUser = await makeEmployeeUser("TEAM_MANAGER", boss);
    const leadAsEmployee = await makeEmployeeUser("EMPLOYEE", lead);
    const hr = await makeUser("HR_STAFF");

    const visible = (actor: Parameters<typeof withRls>[1]) =>
      withRls(db, actor, async (tx) => (await tx.employee.findMany({ select: { id: true } })).map((e) => e.id).sort());

    // Employees see themselves and the managers above them (names on their profile), never peers.
    expect(await visible(devUser)).toEqual([boss, lead, dev].sort());
    expect(await visible(bossUser)).toEqual([boss, lead, dev].sort());
    // Having reports is not enough: the team view needs the Team Manager role.
    expect(await visible(leadAsEmployee)).toEqual([boss, lead].sort());
    expect(await visible(leadAsEmployee)).not.toContain(dev);
    expect(await visible(devUser)).not.toContain(outsider);
    expect((await visible(hr)).length).toBe(4);
    expect(await visible(bossUser)).not.toContain(outsider);

    // Settings never leak to the next transaction on the pooled connection.
    expect((await db.employee.findMany()).length).toBe(4);
  });

  it("hides other users' notifications and sensitive tables entirely", async () => {
    const a = await makeEmployeeUser("EMPLOYEE", await makeEmployee({ firstName: "A" }));
    const b = await makeEmployeeUser("EMPLOYEE", await makeEmployee({ firstName: "B" }));
    await db.notification.createMany({ data: [{ recipientId: a.id, type: "t", title: "for a" }, { recipientId: b.id, type: "t", title: "for b" }] });
    const seen = await withRls(db, a, (tx) => tx.notification.findMany({ select: { title: true } }));
    expect(seen).toEqual([{ title: "for a" }]);
    // Updating someone else's notification affects nothing.
    const changed = await withRls(db, a, (tx) => tx.notification.updateMany({ where: { recipientId: b.id }, data: { readAt: new Date() } }));
    expect(changed.count).toBe(0);
    // No grants on salary, documents, credentials or password hashes.
    await expect(withRls(db, a, (tx) => tx.$queryRaw`SELECT count(*) FROM "employee_compensation"`)).rejects.toThrow(/permission denied/);
    await expect(withRls(db, a, (tx) => tx.$queryRaw`SELECT count(*) FROM "employee_credential"`)).rejects.toThrow(/permission denied/);
    await expect(withRls(db, a, (tx) => tx.$queryRaw`SELECT "password" FROM "account"`)).rejects.toThrow(/permission denied/);
    await expect(withRls(db, a, (tx) => tx.$queryRaw`SELECT "email" FROM "user"`)).rejects.toThrow(/permission denied/);
  });
});
