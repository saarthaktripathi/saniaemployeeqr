import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import {
  changeEmployeeStatus,
  createEmployee,
  deleteEmployees,
  exportEmployeesCsv,
  getEmployee,
  importEmployeesCsv,
  listDirectoryOptions,
  listEmployees,
  recordExit,
  searchEmployeeOptions,
  updateEmployee,
} from "@/server/services/employees";
import { createCompany, deleteCompany, listCompanies, updateCompany } from "@/server/services/companies";
import { addCompensation, deleteCompensation, listCompensation } from "@/server/services/compensation";
import { deleteDocument, getDocumentFile, listDocuments, uploadDocument } from "@/server/services/documents";
import { addHistoryEntry, deleteHistoryEntry, listHistory } from "@/server/services/history";
import { getVerificationSummary, issueCredential } from "@/server/services/credentials";
import { verifyToken } from "@/server/services/verification";
import { getDashboardStats, getDashboardTrends, resetTrendCache } from "@/server/services/dashboard";
import { listAudit } from "@/server/services/audit-read";
import { createUser } from "@/server/services/users";
import { baseEmployee, ctx, db, defaultCompanyId, makeCompany, makeUser, resetDb } from "../support/db";

beforeEach(resetDb);

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Calendar date `n` days from today (UTC), as YYYY-MM-DD. */
const day = (n: number) => iso(new Date(Date.now() + n * DAY));
const tokenOf = (url: string) => url.split("/verify/")[1]!;
let ip = 0;
const fresh = () => ({ requestId: "verify", ipHash: `dir-ip-${++ip}` });

/** Full edit payload for an employee as currently stored (the edit form always sends every field). */
async function editOf(id: string) {
  const e = await db.employee.findUniqueOrThrow({ where: { id } });
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: "",
    workEmail: e.workEmail ?? "",
    phone: e.phone ?? "",
    department: e.department,
    jobTitle: e.jobTitle,
    businessVertical: e.businessVertical ?? "",
    workLocation: e.workLocation ?? "",
    joiningDate: e.joiningDate ? iso(e.joiningDate) : "",
    idIssueDate: iso(e.idIssueDate),
    idExpiresAt: iso(e.idExpiresAt),
    version: e.version,
  };
}

const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();

// ---------------------------------------------------------------------------

describe("companies", () => {
  it("lets the owner create, rename, deactivate and delete empty companies", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCompany(db, owner, { name: " Sania Tech Labs ", code: "stl" }, ctx);
    expect(c).toMatchObject({ name: "Sania Tech Labs", code: "STL", isActive: true });
    await expect(createCompany(db, owner, { name: "sania tech LABS" }, ctx)).rejects.toMatchObject({ code: "CONFLICT", details: { field: "name" } });
    await expect(updateCompany(db, owner, await defaultCompanyId(), { name: "SANIA TECH LABS" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

    const renamed = await updateCompany(db, owner, c.id, { name: "Sania Technologies", code: "" }, ctx);
    expect(renamed).toMatchObject({ name: "Sania Technologies", code: null });
    // Case-only rename of itself is fine.
    await expect(updateCompany(db, owner, c.id, { name: "SANIA Technologies" }, ctx)).resolves.toMatchObject({ name: "SANIA Technologies" });

    await updateCompany(db, owner, c.id, { isActive: false }, ctx);
    await expect(updateCompany(db, owner, await defaultCompanyId(), { isActive: false }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const list = await listCompanies(db, owner, ctx);
    expect(list.map((x) => [x.name, x.isActive])).toEqual([["Sania Job Bowl", true], ["SANIA Technologies", false]]);

    await deleteCompany(db, owner, c.id, ctx);
    expect(await db.company.count()).toBe(1);
    await expect(deleteCompany(db, owner, await defaultCompanyId(), ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const actions = (await db.auditLog.findMany({ where: { action: { startsWith: "company." } }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["company.created", "company.updated", "company.updated", "company.updated", "company.deleted"]);
  });

  it("refuses to delete a company that still has employee records (including archived)", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCompany(db, owner, { name: "Sania Staffing" }, ctx);
    const e = await createEmployee(db, owner, { ...baseEmployee, companyId: c.id }, ctx);
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "left" }, ctx);
    await expect(deleteCompany(db, owner, c.id, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const row = (await listCompanies(db, owner, ctx)).find((x) => x.id === c.id)!;
    expect(row).toMatchObject({ employees: 0, totalRecords: 1 });
  });

  it("restricts company management to holders of company:manage", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCompany(db, owner, { name: "Sania Tech Labs" }, ctx);
    for (const role of ["HR_ADMIN", "HR_STAFF", "MANAGEMENT"] as const) {
      const u = await makeUser(role);
      await expect(createCompany(db, u, { name: `By ${role}` }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updateCompany(db, u, c.id, { isActive: false }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteCompany(db, u, c.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Everyone who can read the directory sees the list.
      expect((await listCompanies(db, u, ctx)).length).toBe(2);
    }
    expect(await db.auditLog.count({ where: { action: "authz.denied", metadata: { path: ["permission"], equals: "company:manage" } } })).toBe(9);
    const granted = await makeUser("HR_ADMIN", ["company:manage"]);
    await expect(createCompany(db, granted, { name: "Granted Co" }, ctx)).resolves.toMatchObject({ name: "Granted Co" });
  });
});

// ---------------------------------------------------------------------------

describe("employee directory fields", () => {
  it("uses the only active company by default and requires a choice when there are several", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    expect(e.companyId).toBe(await defaultCompanyId());

    const tech = await makeCompany("Sania Tech Labs", "STL");
    await expect(createEmployee(db, owner, baseEmployee, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { field: "companyId" } });
    const t = await createEmployee(db, owner, { ...baseEmployee, companyId: tech.id }, ctx);
    expect(t.companyId).toBe(tech.id);

    await db.company.update({ where: { id: tech.id }, data: { isActive: false } });
    await expect(createEmployee(db, owner, { ...baseEmployee, companyId: tech.id }, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { field: "companyId" } });
    // Back to a single active company: the default applies again.
    expect((await createEmployee(db, owner, baseEmployee, ctx)).companyId).toBe(await defaultCompanyId());
    await expect(createEmployee(db, owner, { ...baseEmployee, companyId: "00000000-0000-4000-8000-000000000000" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stores employment details and starts the history with a Joined entry", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(
      db,
      owner,
      {
        ...baseEmployee,
        joiningDate: "2025-01-10",
        employmentType: "Full-time",
        workMode: "hybrid",
        team: "Campus Hiring",
        attendanceRef: "BIO-0042",
        leavePolicy: "Standard 24 days",
        leaveSystemUrl: "https://hr.example.com/leave/42",
      },
      ctx,
    );
    expect(e).toMatchObject({
      employmentType: "FULL_TIME",
      workMode: "HYBRID",
      team: "Campus Hiring",
      attendanceRef: "BIO-0042",
      leavePolicy: "Standard 24 days",
      leaveSystemUrl: "https://hr.example.com/leave/42",
      exitDate: null,
      reportingManagerId: null,
    });
    const history = await listHistory(db, owner, e.id, ctx);
    expect(history).toEqual([
      expect.objectContaining({ kind: "JOINED", effectiveDate: "2025-01-10", toValue: "Talent Partner · Recruitment · Sania Job Bowl", manual: false }),
    ]);
    await expect(createEmployee(db, owner, { ...baseEmployee, leaveSystemUrl: "javascript:alert(1)" }, ctx)).rejects.toThrow();
    await expect(createEmployee(db, owner, { ...baseEmployee, employmentType: "Permanent" }, ctx)).rejects.toThrow(/FULL_TIME/);
  });

  it("keeps fields an update does not send (patch semantics) and records job changes in the history", async () => {
    const owner = await makeUser("OWNER");
    const tech = await makeCompany("Sania Tech Labs", "STL");
    const boss = await createEmployee(db, owner, { ...baseEmployee, firstName: "Boss", companyId: tech.id }, ctx);
    const e = await createEmployee(
      db,
      owner,
      { ...baseEmployee, companyId: (await defaultCompanyId()), employmentType: "INTERN", workMode: "OFFICE", team: "Alpha", attendanceRef: "BIO-1", leavePolicy: "Interns" },
      ctx,
    );

    // An old client that knows nothing about the new fields must not wipe them.
    await updateEmployee(db, owner, e.id, await editOf(e.id), ctx);
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      companyId: await defaultCompanyId(),
      employmentType: "INTERN",
      workMode: "OFFICE",
      team: "Alpha",
      attendanceRef: "BIO-1",
      leavePolicy: "Interns",
    });
    expect((await listHistory(db, owner, e.id, ctx)).map((h) => h.kind)).toEqual(["JOINED"]);

    // Empty values clear them.
    await updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), team: "", attendanceRef: null }, ctx);
    expect(await db.employee.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ team: null, attendanceRef: null, leavePolicy: "Interns" });

    await updateEmployee(
      db,
      owner,
      e.id,
      {
        ...(await editOf(e.id)),
        jobTitle: "Senior Partner",
        department: "Talent Acquisition",
        companyId: tech.id,
        reportingManagerId: boss.id,
        employmentType: "Full-time",
        workMode: "REMOTE",
        workLocation: "Pune",
      },
      ctx,
    );
    const history = await listHistory(db, owner, e.id, ctx);
    const byKind = Object.fromEntries(history.filter((h) => h.kind !== "JOINED").map((h) => [h.kind, [h.fromValue, h.toValue, h.effectiveDate]]));
    expect(byKind).toEqual({
      DESIGNATION: ["Talent Partner", "Senior Partner", day(0)],
      DEPARTMENT: ["Recruitment", "Talent Acquisition", day(0)],
      COMPANY: ["Sania Job Bowl", "Sania Tech Labs", day(0)],
      MANAGER: [null, "Boss Verma", day(0)],
      EMPLOYMENT_TYPE: ["Intern", "Full-time", day(0)],
      WORK_MODE: ["Office", "Remote", day(0)],
      LOCATION: ["Hyderabad", "Pune", day(0)],
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "employee.updated", targetId: e.id }, orderBy: { id: "desc" } });
    expect((audit.metadata as { changed: string[] }).changed).toEqual(
      expect.arrayContaining(["jobTitle", "department", "companyId", "reportingManagerId", "employmentType", "workMode", "workLocation"]),
    );
    expect(JSON.stringify(audit.metadata)).not.toContain("Pune");

    // Transfers only to active companies; a company can't be cleared.
    await db.company.update({ where: { id: await defaultCompanyId() }, data: { isActive: false } });
    await expect(updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), companyId: await defaultCompanyId() }, ctx)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { field: "companyId" },
    });
    await expect(updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), companyId: null }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ---------------------------------------------------------------------------

describe("reporting lines", () => {
  it("rejects self-reporting, loops and archived managers", async () => {
    const owner = await makeUser("OWNER");
    const a = await createEmployee(db, owner, { ...baseEmployee, firstName: "Anil" }, ctx);
    const b = await createEmployee(db, owner, { ...baseEmployee, firstName: "Bina", reportingManagerId: a.id }, ctx);
    const c = await createEmployee(db, owner, { ...baseEmployee, firstName: "Chitra", reportingManagerId: b.id }, ctx);
    expect(b.reportingManagerId).toBe(a.id);

    await expect(updateEmployee(db, owner, a.id, { ...(await editOf(a.id)), reportingManagerId: a.id }, ctx)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { field: "reportingManagerId" },
    });
    // a → c would close the loop c → b → a → c.
    await expect(updateEmployee(db, owner, a.id, { ...(await editOf(a.id)), reportingManagerId: c.id }, ctx)).rejects.toThrow(/loop/);
    await expect(updateEmployee(db, owner, a.id, { ...(await editOf(a.id)), reportingManagerId: b.id }, ctx)).rejects.toThrow(/loop/);

    const d = await createEmployee(db, owner, { ...baseEmployee, firstName: "Dev" }, ctx);
    await changeEmployeeStatus(db, owner, d.id, { action: "archive", reason: "left" }, ctx);
    await expect(updateEmployee(db, owner, a.id, { ...(await editOf(a.id)), reportingManagerId: d.id }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createEmployee(db, owner, { ...baseEmployee, reportingManagerId: d.id }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createEmployee(db, owner, { ...baseEmployee, reportingManagerId: "00000000-0000-4000-8000-000000000000" }, ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("shows direct reports and unlinks them when the manager is deleted", async () => {
    const owner = await makeUser("OWNER");
    const boss = await createEmployee(db, owner, { ...baseEmployee, firstName: "Boss" }, ctx);
    const r1 = await createEmployee(db, owner, { ...baseEmployee, firstName: "Ravi", reportingManagerId: boss.id }, ctx);
    const r2 = await createEmployee(db, owner, { ...baseEmployee, firstName: "Meera" }, ctx);
    await updateEmployee(db, owner, r2.id, { ...(await editOf(r2.id)), reportingManagerId: boss.id }, ctx);
    const archived = await createEmployee(db, owner, { ...baseEmployee, firstName: "Old", reportingManagerId: boss.id }, ctx);
    await changeEmployeeStatus(db, owner, archived.id, { action: "archive", reason: "left" }, ctx);

    const view = await getEmployee(db, owner, boss.id, ctx);
    expect(view.directReports.map((r) => r.displayName)).toEqual(["Meera Verma", "Ravi Verma"]);
    expect(view._count.directReports).toBe(2);
    const report = await getEmployee(db, owner, r1.id, ctx);
    expect(report.reportingManager).toMatchObject({ id: boss.id, displayName: "Boss Verma" });
    expect((await listHistory(db, owner, r2.id, ctx)).find((h) => h.kind === "MANAGER")).toMatchObject({ fromValue: null, toValue: "Boss Verma" });
    expect((await listEmployees(db, owner, { manager: boss.id }, ctx)).total).toBe(2);

    const options = await searchEmployeeOptions(db, owner, { q: "bo", exclude: r1.id }, ctx);
    expect(options.map((o) => o.displayName)).toEqual(["Boss Verma"]);
    expect(await searchEmployeeOptions(db, owner, { q: "", exclude: boss.id }, ctx)).toHaveLength(2); // archived excluded

    await deleteEmployees(db, owner, { ids: [boss.id], reason: "test" }, ctx);
    expect((await db.employee.findUniqueOrThrow({ where: { id: r1.id } })).reportingManagerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("exit and rejoining", () => {
  async function exitSetup() {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, { ...baseEmployee, joiningDate: day(-400) }, ctx);
    const issued = await issueCredential(db, owner, e.id, ctx);
    return { owner, e, token: tokenOf(issued.url) };
  }

  it("records an exit: inactive, exit details, history, audit, and the QR verifies as inactive", async () => {
    const { owner, e, token } = await exitSetup();
    expect((await verifyToken(db, token, fresh())).status).toBe("VERIFIED");
    await recordExit(db, owner, e.id, { exitDate: day(-1), exitType: "RESIGNATION", reason: "Relocating abroad" }, ctx);

    const stored = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(stored).toMatchObject({ employmentStatus: "INACTIVE", exitType: "RESIGNATION", exitReason: "Relocating abroad", archivedAt: null });
    expect(iso(stored.exitDate!)).toBe(day(-1));
    expect((await verifyToken(db, token, fresh())).status).toBe("INACTIVE");
    // The QR is not revoked: the record still answers "not a current employee".
    expect(await db.employeeCredential.count({ where: { employeeId: e.id, revokedAt: null } })).toBe(1);

    expect((await listHistory(db, owner, e.id, ctx))[0]).toMatchObject({ kind: "EXITED", effectiveDate: day(-1), toValue: "Resignation" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "employee.exited" } });
    expect(audit.metadata).toEqual({ from: "ACTIVE", to: "INACTIVE", exitType: "RESIGNATION" });
    expect(JSON.stringify(audit.metadata)).not.toContain("Relocating");

    expect((await listEmployees(db, owner, { status: "EXITED" }, ctx)).rows.map((r) => r.id)).toEqual([e.id]);
    await createEmployee(db, owner, { ...baseEmployee, firstName: "Still" }, ctx);
    expect((await listEmployees(db, owner, { status: "EXITED" }, ctx)).total).toBe(1);

    await expect(recordExit(db, owner, e.id, { exitDate: day(0), exitType: "OTHER" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("validates the exit date and permissions", async () => {
    const { owner, e } = await exitSetup();
    await expect(recordExit(db, owner, e.id, { exitDate: day(2), exitType: "RESIGNATION" }, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { field: "exitDate" } });
    await expect(recordExit(db, owner, e.id, { exitDate: day(-500), exitType: "RESIGNATION" }, ctx)).rejects.toThrow(/before the joining date/);
    for (const role of ["HR_STAFF", "MANAGEMENT"] as const) {
      await expect(recordExit(db, await makeUser(role), e.id, { exitDate: day(0), exitType: "RESIGNATION" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // One day of tolerance for time zones ahead of UTC.
    await expect(recordExit(db, await makeUser("HR_ADMIN"), e.id, { exitDate: day(1), exitType: "CONTRACT_END" }, ctx)).resolves.toMatchObject({ employmentStatus: "INACTIVE" });

    const archived = await createEmployee(db, owner, baseEmployee, ctx);
    await changeEmployeeStatus(db, owner, archived.id, { action: "archive", reason: "left" }, ctx);
    await expect(recordExit(db, owner, archived.id, { exitDate: day(0), exitType: "OTHER" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("allows correcting exit details only after an exit, and rejoining clears them", async () => {
    const { owner, e, token } = await exitSetup();
    await expect(updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), exitType: "RESIGNATION" }, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    // Blank exit fields from the form are fine before an exit.
    await updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), exitDate: "", exitType: "", exitReason: "" }, ctx);

    await recordExit(db, owner, e.id, { exitDate: day(-3), exitType: "RESIGNATION" }, ctx);
    await updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), exitDate: day(-2), exitType: "Contract end", exitReason: "Project closed" }, ctx);
    const corrected = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(corrected).toMatchObject({ exitType: "CONTRACT_END", exitReason: "Project closed" });
    expect(iso(corrected.exitDate!)).toBe(day(-2));
    await expect(updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), exitDate: "" }, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { field: "exitDate" } });
    await expect(updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), exitDate: day(5) }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    // Omitting the exit fields keeps them.
    await updateEmployee(db, owner, e.id, await editOf(e.id), ctx);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).exitReason).toBe("Project closed");

    await changeEmployeeStatus(db, owner, e.id, { action: "reactivate", reason: "Rehired" }, ctx);
    const back = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(back).toMatchObject({ employmentStatus: "ACTIVE", exitDate: null, exitType: null, exitReason: null });
    expect((await listHistory(db, owner, e.id, ctx))[0]).toMatchObject({ kind: "REJOINED", fromValue: `Exited ${day(-2)}`, note: "Rehired" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "employee.reactivated" } });
    expect(audit.metadata).toMatchObject({ rejoined: true });
    expect((await verifyToken(db, token, fresh())).status).toBe("VERIFIED");
  });
});

// ---------------------------------------------------------------------------

describe("directory search, filters and export", () => {
  it("filters by company, designation, type, work mode and email, and exports the new columns", async () => {
    const owner = await makeUser("OWNER");
    const tech = await makeCompany("Sania Tech Labs", "STL");
    const def = await defaultCompanyId();
    const a = await createEmployee(db, owner, { ...baseEmployee, companyId: def, workEmail: "asha.verma@sania.test", phone: "+91 98888 77777", employmentType: "FULL_TIME", workMode: "OFFICE", team: "Core", joiningDate: "2024-05-01" }, ctx);
    const b = await createEmployee(db, owner, { ...baseEmployee, firstName: "Ravi", companyId: tech.id, jobTitle: "Software Engineer", department: "Technology", employmentType: "INTERN", workMode: "REMOTE", reportingManagerId: a.id }, ctx);
    await createEmployee(db, owner, { ...baseEmployee, firstName: "Kiran", companyId: tech.id, jobTitle: "software engineer", department: "Technology", workMode: "HYBRID" }, ctx);
    await addCompensation(db, owner, a.id, { type: "SALARY", amount: "987654", frequency: "ANNUAL", effectiveFrom: day(-10) }, ctx);

    const ids = async (q: Record<string, string>) => (await listEmployees(db, owner, q, ctx)).rows.map((r) => r.displayName).sort();
    expect(await ids({ company: tech.id })).toEqual(["Kiran Verma", "Ravi Verma"]);
    expect(await ids({ company: def })).toEqual(["Asha Verma"]);
    expect(await ids({ designation: "SOFTWARE ENGINEER" })).toEqual(["Kiran Verma", "Ravi Verma"]);
    expect(await ids({ type: "INTERN" })).toEqual(["Ravi Verma"]);
    expect(await ids({ mode: "HYBRID" })).toEqual(["Kiran Verma"]);
    expect(await ids({ manager: a.id })).toEqual(["Ravi Verma"]);
    expect(await ids({ q: "asha.ver" })).toEqual(["Asha Verma"]);
    expect(await ids({ company: tech.id, mode: "REMOTE", designation: "software engineer" })).toEqual(["Ravi Verma"]);
    const sorted = (await listEmployees(db, owner, { sort: "joiningDate", dir: "asc" }, ctx)).rows.map((r) => r.displayName);
    expect(sorted[0]).toBe("Asha Verma"); // employees without a joining date sort last
    const row = (await listEmployees(db, owner, { company: tech.id, type: "INTERN" }, ctx)).rows[0]!;
    expect(row).toMatchObject({ company: { name: "Sania Tech Labs", code: "STL" }, employmentType: "INTERN", workMode: "REMOTE" });

    const options = await listDirectoryOptions(db, owner, ctx);
    expect(options.companies.map((c) => c.name)).toEqual(["Sania Job Bowl", "Sania Tech Labs"]);
    expect(options.designations).toEqual(expect.arrayContaining(["Software Engineer", "Talent Partner"]));
    expect(options.teams).toEqual(["Core"]);

    const csv = await exportEmployeesCsv(db, owner, {}, ctx);
    const [header, ...lines] = csv.trim().split("\r\n");
    expect(header.split(",")).toEqual(expect.arrayContaining(["company", "employmentType", "workMode", "team", "reportingManager", "joiningDate", "exitDate"]));
    expect(lines.find((l) => l.includes("Ravi Verma"))).toContain(a.employeeCode);
    expect(lines.find((l) => l.includes("Ravi Verma"))).toContain("Sania Tech Labs");
    expect(csv).not.toContain("98888");
    expect(csv).not.toContain("987654");
    expect(header).not.toMatch(/phone|salary|compensation|attendance|leave/i);
    expect(b.reportingManagerId).toBe(a.id);
  });
});

// ---------------------------------------------------------------------------

describe("bulk import with directory columns", () => {
  it("resolves companies by name or code and managers by employee ID", async () => {
    const owner = await makeUser("OWNER");
    const tech = await makeCompany("Sania Tech Labs", "STL");
    const boss = await createEmployee(db, owner, { ...baseEmployee, firstName: "Boss", companyId: tech.id }, ctx);
    const csv =
      "firstName,company,department,jobTitle,employmentType,workMode,reportingManager,team,attendanceRef,leavePolicy\r\n" +
      `Ravi,Sania Tech Labs,Technology,Developer,Full-time,remote,${boss.employeeCode.toLowerCase()},Core,BIO-7,Standard\r\n` +
      "Meera,stl,Technology,QA,intern,hybrid,,,,\r\n" +
      "Kiran,  sania job bowl ,Operations,Lead,,,,,,\r\n";
    const res = await importEmployeesCsv(db, owner, csv, ctx);
    expect(res).toMatchObject({ created: 3, skipped: 0 });
    const byName = Object.fromEntries((await db.employee.findMany({ where: { firstName: { in: ["Ravi", "Meera", "Kiran"] } } })).map((e) => [e.firstName, e]));
    expect(byName.Ravi).toMatchObject({ companyId: tech.id, employmentType: "FULL_TIME", workMode: "REMOTE", reportingManagerId: boss.id, team: "Core", attendanceRef: "BIO-7", leavePolicy: "Standard" });
    expect(byName.Meera).toMatchObject({ companyId: tech.id, employmentType: "INTERN", workMode: "HYBRID", reportingManagerId: null });
    expect(byName.Kiran).toMatchObject({ companyId: await defaultCompanyId(), employmentType: null });
    expect(await db.employmentHistory.count({ where: { kind: "JOINED", employeeId: { in: Object.values(byName).map((e) => e.id) } } })).toBe(3);
  });

  it("reports unknown or inactive companies, missing companies and unknown managers per row", async () => {
    const owner = await makeUser("OWNER");
    await makeCompany("Sania Tech Labs", "STL");
    const old = await makeCompany("Old Co", "OLD");
    await db.company.update({ where: { id: old.id }, data: { isActive: false } });
    const csv =
      "firstName,company,department,jobTitle,reportingManager,employmentType\r\n" +
      "A,Nope Inc,Ops,Lead,,\r\n" +
      "B,old,Ops,Lead,,\r\n" +
      "C,,Ops,Lead,,\r\n" +
      "D,STL,Ops,Lead,SJB-1999-999,\r\n" +
      "E,STL,Ops,Lead,,Permanent\r\n";
    const err = await importEmployeesCsv(db, owner, csv, ctx).catch((e) => e);
    expect(err).toMatchObject({ code: "VALIDATION" });
    const rows = (err.details.rows as { row: number; messages: string[] }[]).map((r) => [r.row, r.messages.join("; ")]);
    expect(rows).toEqual([
      [2, expect.stringContaining("no company named “Nope Inc”")],
      [3, expect.stringContaining("Old Co is inactive")],
      [4, expect.stringContaining("company: required")],
      [5, expect.stringContaining("no current employee with ID SJB-1999-999")],
      [6, expect.stringContaining("FULL_TIME")],
    ]);
    expect(await db.employee.count()).toBe(0);
  });

  it("skips a row repeated in the same file even when it has a work email", async () => {
    const owner = await makeUser("OWNER");
    const csv = "firstName,lastName,department,jobTitle,workEmail\r\nAsha,Verma,Recruitment,Partner,asha@x.com\r\nAsha,Verma,Recruitment,Partner,ASHA@x.com\r\n";
    // Without skipping, a repeated email in one file is still an error.
    await expect(importEmployeesCsv(db, owner, csv, ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { rows: [{ row: 3, messages: ["workEmail: duplicated in file"] }] } });
    expect(await importEmployeesCsv(db, owner, csv, ctx, { skipDuplicates: true })).toMatchObject({ created: 1, skipped: 1 });
    expect(await importEmployeesCsv(db, owner, csv, ctx, { skipDuplicates: true })).toMatchObject({ created: 0, skipped: 2 });
    expect(await db.employee.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("compensation (restricted)", () => {
  it("lets the owner add, view and remove revisions; amounts stay out of the audit log", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const current = await addCompensation(db, owner, e.id, { type: "SALARY", amount: "1,20,000.50", frequency: "MONTHLY", effectiveFrom: day(-30), notes: "CTC revision" }, ctx);
    const future = await addCompensation(db, owner, e.id, { type: "SALARY", amount: 130000, frequency: "MONTHLY", effectiveFrom: day(30) }, ctx);

    const res = await listCompensation(db, owner, e.id, ctx);
    expect(res.rows.map((r) => [r.amount, r.effectiveFrom])).toEqual([
      ["130000.00", day(30)],
      ["120000.50", day(-30)],
    ]);
    expect(res.currentId).toBe(current.id); // the future revision is not in effect yet
    expect(res.rows[1]).toMatchObject({ type: "SALARY", currency: "INR", frequency: "MONTHLY", notes: "CTC revision", createdBy: "OWNER user" });

    const audits = await db.auditLog.findMany({ where: { action: { startsWith: "compensation." } }, orderBy: { id: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["compensation.added", "compensation.added", "compensation.viewed"]);
    const dump = JSON.stringify(audits.map((a) => a.metadata)) + JSON.stringify((await db.outboxEvent.findMany()).map((o) => o.payload));
    for (const secret of ["120000", "130000", "1,20,000", "CTC revision"]) expect(dump).not.toContain(secret);

    await deleteCompensation(db, owner, e.id, future.id, ctx);
    expect((await listCompensation(db, owner, e.id, ctx)).rows).toHaveLength(1);
    await expect(deleteCompensation(db, owner, e.id, future.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // An entry can only be removed through its own employee.
    const other = await createEmployee(db, owner, { ...baseEmployee, firstName: "Other" }, ctx);
    await expect(deleteCompensation(db, owner, other.id, current.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await deleteEmployees(db, owner, { ids: [e.id], reason: "test" }, ctx);
    expect(await db.employeeCompensation.count()).toBe(0);
  });

  it("denies HR administrators and management unless granted, and audits the attempt", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const input = { type: "STIPEND", amount: "15000", frequency: "MONTHLY", effectiveFrom: day(0) };
    for (const role of ["HR_ADMIN", "MANAGEMENT", "HR_STAFF"] as const) {
      const u = await makeUser(role);
      await expect(listCompensation(db, u, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(addCompensation(db, u, e.id, input, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.auditLog.count({ where: { action: "authz.denied", metadata: { path: ["permission"], equals: "compensation:read" } } })).toBe(3);

    const reader = await makeUser("HR_STAFF", ["compensation:read"]);
    await addCompensation(db, owner, e.id, input, ctx);
    expect((await listCompensation(db, reader, e.id, ctx)).rows).toHaveLength(1);
    await expect(addCompensation(db, reader, e.id, input, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = await makeUser("HR_ADMIN", ["compensation:manage"]);
    await expect(addCompensation(db, manager, e.id, { ...input, amount: "16000" }, ctx)).resolves.toHaveProperty("id");

    await expect(addCompensation(db, owner, e.id, { ...input, amount: "-1" }, ctx)).rejects.toThrow();
    await changeEmployeeStatus(db, owner, e.id, { action: "archive", reason: "left" }, ctx);
    await expect(addCompensation(db, owner, e.id, input, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(listCompensation(db, owner, "00000000-0000-4000-8000-000000000000", ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides compensation activity from users without security audit access", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    await listCompensation(db, owner, e.id, ctx);
    const mgmt = await makeUser("MANAGEMENT");
    expect((await listAudit(db, mgmt, {}, ctx)).rows.map((r) => r.action)).not.toContain("compensation.viewed");
    expect((await listAudit(db, owner, {}, ctx)).rows.map((r) => r.action)).toContain("compensation.viewed");
  });
});

// ---------------------------------------------------------------------------

describe("documents (restricted)", () => {
  it("stores PDFs and images by content type, serves them back and audits downloads", async () => {
    const owner = await makeUser("OWNER");
    const admin = await makeUser("HR_ADMIN");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const up = await uploadDocument(db, admin, e.id, { category: "OFFER_LETTER", title: "Offer letter", fileName: "C:\\fakepath\\offer.PDF" }, pdf, ctx);
    expect(up).toMatchObject({ contentType: "application/pdf", size: pdf.byteLength });
    const image = await png();
    await uploadDocument(db, admin, e.id, { category: "ID_PROOF", title: "Masked Aadhaar", fileName: "scan.jpg", notes: "masked" }, image, ctx);

    const docs = await listDocuments(db, admin, e.id, ctx);
    expect(docs.map((d) => [d.title, d.fileName, d.contentType])).toEqual([
      ["Masked Aadhaar", "scan.png", "image/png"],
      ["Offer letter", "offer.pdf", "application/pdf"],
    ]);
    expect(docs[0]).toMatchObject({ category: "ID_PROOF", notes: "masked", uploadedBy: "HR_ADMIN user", size: image.byteLength });
    expect(await db.employeeDocument.findUniqueOrThrow({ where: { id: up.id } })).toMatchObject({ storageKey: `db:${up.id}` });

    const file = await getDocumentFile(db, admin, e.id, up.id, ctx);
    expect(file).toMatchObject({ fileName: "offer.pdf", contentType: "application/pdf" });
    expect(file.data.equals(pdf)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "document.downloaded", targetId: e.id } })).toBe(1);
    const uploadAudit = await db.auditLog.findFirstOrThrow({ where: { action: "document.uploaded" } });
    expect(JSON.stringify(uploadAudit.metadata)).not.toContain("offer");

    // A document is only reachable through its own employee.
    const other = await createEmployee(db, owner, { ...baseEmployee, firstName: "Other" }, ctx);
    await expect(getDocumentFile(db, admin, other.id, up.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDocument(db, admin, other.id, up.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await deleteDocument(db, admin, e.id, up.id, ctx);
    expect(await db.employeeDocument.count()).toBe(1);
    expect(await db.employeeDocumentBlob.count()).toBe(1);

    await deleteEmployees(db, owner, { ids: [e.id], reason: "test" }, ctx);
    expect(await db.employeeDocument.count()).toBe(0);
    expect(await db.employeeDocumentBlob.count()).toBe(0);
  });

  it("rejects disguised, empty and oversized files", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const meta = { category: "OTHER", title: "File", fileName: "file.pdf" };
    await expect(uploadDocument(db, owner, e.id, meta, Buffer.from("<html><script>alert(1)</script></html>"), ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadDocument(db, owner, e.id, meta, Buffer.alloc(0), ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024)]);
    await expect(uploadDocument(db, owner, e.id, meta, big, ctx)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(uploadDocument(db, owner, e.id, { ...meta, category: "SELFIE" }, pdf, ctx)).rejects.toThrow();
    await expect(uploadDocument(db, owner, "00000000-0000-4000-8000-000000000000", meta, pdf, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.employeeDocument.count()).toBe(0);
  });

  it("is limited to owners, HR administrators and explicit grants", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, baseEmployee, ctx);
    const doc = await uploadDocument(db, owner, e.id, { category: "CONTRACT", title: "Contract", fileName: "c.pdf" }, pdf, ctx);
    for (const role of ["HR_STAFF", "MANAGEMENT"] as const) {
      const u = await makeUser(role);
      await expect(listDocuments(db, u, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getDocumentFile(db, u, e.id, doc.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(uploadDocument(db, u, e.id, { category: "OTHER", title: "x", fileName: "x.pdf" }, pdf, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteDocument(db, u, e.id, doc.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const reader = await makeUser("MANAGEMENT", ["document:read"]);
    expect(await listDocuments(db, reader, e.id, ctx)).toHaveLength(1);
    await expect(deleteDocument(db, reader, e.id, doc.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------

describe("employment history", () => {
  it("lists newest first and lets HR add and remove manual entries only", async () => {
    const owner = await makeUser("OWNER");
    const e = await createEmployee(db, owner, { ...baseEmployee, joiningDate: "2025-01-10" }, ctx);
    const manual = await addHistoryEntry(db, owner, e.id, { kind: "DESIGNATION", effectiveDate: "2025-06-01", fromValue: "Associate", toValue: "Talent Partner", note: "Before the system" }, ctx);
    await updateEmployee(db, owner, e.id, { ...(await editOf(e.id)), jobTitle: "Senior Partner" }, ctx);

    const history = await listHistory(db, owner, e.id, ctx);
    expect(history.map((h) => [h.kind, h.effectiveDate, h.manual])).toEqual([
      ["DESIGNATION", day(0), false],
      ["DESIGNATION", "2025-06-01", true],
      ["JOINED", "2025-01-10", false],
    ]);
    expect(history[1]).toMatchObject({ fromValue: "Associate", toValue: "Talent Partner", note: "Before the system", createdBy: "OWNER user" });

    const staff = await makeUser("HR_STAFF");
    expect(await listHistory(db, staff, e.id, ctx)).toHaveLength(3);
    await expect(addHistoryEntry(db, staff, e.id, { kind: "NOTE", effectiveDate: day(0), note: "x" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteHistoryEntry(db, staff, e.id, manual.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(deleteHistoryEntry(db, owner, e.id, history[0].id, ctx)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const other = await createEmployee(db, owner, { ...baseEmployee, firstName: "Other" }, ctx);
    await expect(deleteHistoryEntry(db, owner, other.id, manual.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteHistoryEntry(db, owner, e.id, manual.id, ctx);
    expect((await listHistory(db, owner, e.id, ctx)).map((h) => h.manual)).toEqual([false, false]);
    expect((await db.auditLog.findMany({ where: { action: { startsWith: "employee.history_" } }, orderBy: { id: "asc" } })).map((a) => a.action)).toEqual([
      "employee.history_added",
      "employee.history_removed",
    ]);
    await expect(addHistoryEntry(db, owner, "00000000-0000-4000-8000-000000000000", { kind: "NOTE", effectiveDate: day(0), note: "x" }, ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------

describe("dashboard, verification and roles", () => {
  it("counts employees per company and keeps KPI history correct after an exit", async () => {
    resetTrendCache();
    const owner = await makeUser("OWNER");
    const tech = await makeCompany("Sania Tech Labs", "STL");
    await makeCompany("Empty Co");
    const def = await defaultCompanyId();
    const a = await createEmployee(db, owner, { ...baseEmployee, companyId: def }, ctx);
    const b = await createEmployee(db, owner, { ...baseEmployee, firstName: "B", companyId: def }, ctx);
    const c = await createEmployee(db, owner, { ...baseEmployee, firstName: "C", companyId: tech.id }, ctx);
    const gone = await createEmployee(db, owner, { ...baseEmployee, firstName: "Gone", companyId: tech.id }, ctx);
    await changeEmployeeStatus(db, owner, gone.id, { action: "archive", reason: "left" }, ctx);

    const stats = await getDashboardStats(db, owner, ctx);
    expect(stats.companies.map((x) => [x.name, x.count])).toEqual([
      ["Sania Job Bowl", 2],
      ["Sania Tech Labs", 1],
      ["Empty Co", 0],
    ]);

    const weeksAgo = (w: number) => new Date(Date.now() - w * 7 * DAY - 3_600_000);
    for (const id of [a.id, b.id, c.id]) await db.employee.update({ where: { id }, data: { createdAt: weeksAgo(3), joiningDate: weeksAgo(3) } });
    await db.employee.update({ where: { id: gone.id }, data: { createdAt: weeksAgo(3), archivedAt: weeksAgo(1) } });
    await recordExit(db, owner, b.id, { exitDate: day(0), exitType: "RESIGNATION" }, ctx);
    const t = await getDashboardTrends(db, owner, ctx);
    // "gone" was archived just over a week ago, so it drops out at the one-week point; b exited today.
    expect(t.total).toEqual([0, 0, 0, 0, 4, 4, 3, 3]);
    expect(t.active).toEqual([0, 0, 0, 0, 4, 4, 3, 2]);
    expect(t.inactive).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    resetTrendCache();
  });

  it("shows the employee's company on public verification and summarises scans for HR", async () => {
    const owner = await makeUser("OWNER");
    const tech = await makeCompany("Sania Tech Labs", "STL");
    const e = await createEmployee(db, owner, { ...baseEmployee, companyId: tech.id }, ctx);
    const token = tokenOf((await issueCredential(db, owner, e.id, ctx)).url);
    const staff = await makeUser("HR_STAFF");
    expect(await getVerificationSummary(db, staff, e.id, ctx)).toEqual({ last30Days: 0, lastCheckedAt: null, lastResult: null });

    const v = await verifyToken(db, token, fresh());
    expect(v.employee).toMatchObject({ company: "Sania Tech Labs", displayName: "Asha Verma" });
    await changeEmployeeStatus(db, owner, e.id, { action: "deactivate" }, ctx);
    await verifyToken(db, token, fresh());
    const old = await db.verificationEvent.create({ data: { result: "VERIFIED", employeeId: e.id, createdAt: new Date(Date.now() - 40 * DAY) } });

    const summary = await getVerificationSummary(db, staff, e.id, ctx);
    expect(summary).toMatchObject({ last30Days: 2, lastResult: "INACTIVE" });
    expect(summary.lastCheckedAt).not.toBe(old.createdAt.toISOString());
    await expect(getVerificationSummary(db, { ...staff, role: "NOBODY" as never }, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supports a read-only Management role", async () => {
    const owner = await makeUser("OWNER");
    const created = await createUser(db, owner, { name: "Leader", email: "leader@sania.test", role: "MANAGEMENT", password: "long-enough-pass", extraPermissions: [] }, ctx);
    expect(created.role).toBe("MANAGEMENT");
    const e = await createEmployee(db, owner, baseEmployee, ctx);

    const mgmt = await makeUser("MANAGEMENT");
    expect((await listEmployees(db, mgmt, {}, ctx)).total).toBe(1);
    expect((await getEmployee(db, mgmt, e.id, ctx)).id).toBe(e.id);
    expect((await listAudit(db, mgmt, {}, ctx)).rows.length).toBeGreaterThan(0);
    expect((await getDashboardStats(db, mgmt, ctx)).totalRecords).toBe(1);
    await expect(createEmployee(db, mgmt, baseEmployee, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateEmployee(db, mgmt, e.id, await editOf(e.id), ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportEmployeesCsv(db, mgmt, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeEmployeeStatus(db, mgmt, e.id, { action: "deactivate" }, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issueCredential(db, mgmt, e.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Security events (sign-ins, users, settings, compensation) stay owner-only.
    expect((await listAudit(db, mgmt, {}, ctx)).rows.map((r) => r.action)).not.toContain("users.created");
  });
});
