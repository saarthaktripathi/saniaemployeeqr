/**
 * DEVELOPMENT/DEMO SEED — fictional data only. Refuses to run against non-local
 * databases or in production. Creates three demo accounts and sample employees.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error("Refusing to seed: development seed is only allowed against a local database.");
  process.exit(1);
}

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vihaan", "Isha", "Arjun", "Saanvi", "Kiran", "Nisha", "Farhan", "Leela", "Dev", "Zara", "Tara", "Yusuf", "Pooja", "Neel"];
const LAST = ["Sharma", "Reddy", "Iyer", "Khan", "Patel", "Nair", "Gupta", "Das", "Menon", "Singh", "", "Rao"];
const DEPTS: [string, string][] = [
  ["Recruitment", "Talent Partner"],
  ["Operations", "Operations Associate"],
  ["Client Success", "Account Manager"],
  ["Finance", "Accounts Executive"],
  ["Technology", "Software Engineer"],
  ["Human Resources", "HR Generalist"],
];
const VERTICALS = ["Staffing", "Executive Search", "Campus Hiring", "RPO"];
const LOCATIONS = ["Hyderabad", "Bengaluru", "Pune", "Remote — India"];
const TEAMS: Record<string, string> = {
  Recruitment: "Campus Hiring",
  Operations: "Delivery",
  "Client Success": "Key Accounts",
  Finance: "Payroll",
  Technology: "Platform",
  "Human Resources": "People Ops",
};

function employmentTypeFor(i: number) {
  if (i % 10 === 9) return "INTERN" as const;
  if (i % 7 === 3) return "CONTRACT" as const;
  if (i % 8 === 6) return "CONSULTANT" as const;
  if (i % 13 === 12) return "PART_TIME" as const;
  return "FULL_TIME" as const;
}

async function main() {
  const { db } = await import("@/server/db/client");
  const { createUser } = await import("@/server/services/users");
  const { createEmployee, changeEmployeeStatus, recordExit } = await import("@/server/services/employees");
  const { issueCredential, revokeCredential } = await import("@/server/services/credentials");
  const { createCompany } = await import("@/server/services/companies");
  const { addCompensation } = await import("@/server/services/compensation");
  const { systemContext, systemActor } = await import("@/server/services/context");
  const { createInvitation, acceptInvitation } = await import("@/server/services/accounts");
  const { createTask } = await import("@/server/services/tasks");
  const { applyLeave, decideLeave, getMyLeave } = await import("@/server/services/leave");
  const { addDays, localDate, weekdayOf, zonedTimeToUtc } = await import("@/lib/time");

  const ctx = systemContext("seed");
  const bootstrap = systemActor();

  if ((await db.user.count()) > 0) {
    console.log("Database already has users — skipping seed. Use `npm run db:reset` for a fresh start.");
    await db.$disconnect();
    return;
  }

  // Dev convenience: privileged MFA enforcement is off in the local seed only.
  await db.companySettings.update({ where: { id: 1 }, data: { requireMfaForPrivileged: false } });

  const pw = () => `Dev-${randomBytes(9).toString("base64url")}`;
  const accounts = [
    { name: "Sania Owner", email: "owner@sania.local", role: "OWNER" as const, password: process.env.SEED_OWNER_PASSWORD ?? pw() },
    { name: "Hari HR Admin", email: "hradmin@sania.local", role: "HR_ADMIN" as const, password: process.env.SEED_HRADMIN_PASSWORD ?? pw() },
    { name: "Sita HR Staff", email: "hrstaff@sania.local", role: "HR_STAFF" as const, password: process.env.SEED_HRSTAFF_PASSWORD ?? pw() },
    { name: "Meena Management", email: "management@sania.local", role: "MANAGEMENT" as const, password: process.env.SEED_MANAGEMENT_PASSWORD ?? pw() },
  ];
  // The system actor creates the owner; everything after is done (and audited) as that owner.
  const owner = await createUser(db, bootstrap, { ...accounts[0], extraPermissions: [] }, ctx);
  const actor = { ...bootstrap, id: owner.id, email: owner.email, name: owner.name };
  for (const a of accounts.slice(1)) await createUser(db, actor, { ...a, extraPermissions: [] }, ctx);

  // The migration created the primary company; add two more fictional group companies.
  const primary = await db.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const tech = await createCompany(db, actor, { name: "Sania Tech Labs", code: "STL" }, ctx);
  const staffing = await createCompany(db, actor, { name: "Sania Staffing Services", code: "SSS" }, ctx);
  const companies = [primary, primary, tech, staffing];

  const count = Number(process.env.SEED_EMPLOYEES ?? 24);
  const heads: string[] = []; // first employee of each department manages the rest of it
  const created: { id: string; i: number; active: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const [department, jobTitle] = DEPTS[i % DEPTS.length]!;
    const today = new Date();
    const expiry = new Date(today);
    // A mix of validity: most valid, a few expiring soon, a few expired.
    expiry.setUTCDate(expiry.getUTCDate() + (i % 9 === 0 ? -10 : i % 7 === 0 ? 12 : 200 + i * 5));
    const issue = new Date(expiry);
    issue.setUTCFullYear(issue.getUTCFullYear() - 1);
    const location = LOCATIONS[i % LOCATIONS.length]!;
    const type = employmentTypeFor(i);
    const emp = await createEmployee(
      db,
      actor,
      {
        firstName: FIRST[i % FIRST.length]!,
        lastName: LAST[i % LAST.length]!,
        companyId: companies[i % companies.length]!.id,
        department,
        jobTitle: i < DEPTS.length ? `${department} Lead` : jobTitle,
        businessVertical: VERTICALS[i % VERTICALS.length],
        employmentType: type,
        workMode: location.startsWith("Remote") ? "REMOTE" : i % 5 === 2 ? "HYBRID" : "OFFICE",
        workLocation: location,
        team: TEAMS[department],
        reportingManagerId: heads[i % DEPTS.length],
        attendanceRef: `BIO-${1000 + i}`,
        leavePolicy: type === "INTERN" ? "Intern – 12 days" : "Standard – 24 days",
        workEmail: `employee${i + 1}@example.invalid`,
        joiningDate: issue.toISOString().slice(0, 10),
        idIssueDate: issue.toISOString().slice(0, 10),
        idExpiresAt: expiry.toISOString().slice(0, 10),
      },
      ctx,
    );
    if (i < DEPTS.length) heads.push(emp.id);
    if (i < 8) {
      const pay = type === "INTERN" ? { type: "STIPEND" as const, amount: "15000" } : type === "CONSULTANT" ? { type: "FEE" as const, amount: "90000" } : { type: "SALARY" as const, amount: String(35000 + i * 6500) };
      await addCompensation(db, actor, emp.id, { ...pay, currency: "INR", frequency: "MONTHLY", effectiveFrom: issue.toISOString().slice(0, 10), notes: "Demo figure" }, ctx);
    }
    if (i % 5 !== 4) {
      const cred = await issueCredential(db, actor, emp.id, ctx);
      if (i % 11 === 10) await revokeCredential(db, actor, cred.id, { reason: "Card reported lost (demo)" }, ctx);
    }
    if (i % 6 === 5) await changeEmployeeStatus(db, actor, emp.id, { action: "deactivate", reason: "Demo: contract ended" }, ctx);
    created.push({ id: emp.id, i, active: i % 6 !== 5 && i !== count - 2 });
    if (i === count - 2) {
      const exitDate = new Date(today);
      exitDate.setUTCDate(exitDate.getUTCDate() - 5);
      await recordExit(db, actor, emp.id, { exitDate: exitDate.toISOString().slice(0, 10), exitType: "RESIGNATION", reason: "Demo: moved to higher studies" }, ctx);
    }
  }

  // ---------------------------------------------------------------------------
  // Workforce demo: employee logins (through the real invitation flow), attendance history,
  // tasks and leave. The team manager is the first department head; the demo employee reports to them.
  // ---------------------------------------------------------------------------
  const tz = (await db.attendancePolicy.findUniqueOrThrow({ where: { id: 1 } })).timezone;
  const today = localDate(new Date(), tz);
  const seedIp = { requestId: "seed", ipHash: "seed" };
  async function giveLogin(employeeId: string, email: string, role: "EMPLOYEE" | "TEAM_MANAGER", password: string) {
    const invite = await createInvitation(db, actor, { employeeId, email, role }, ctx);
    await acceptInvitation(db, invite.link.split("/").pop(), { password, confirmPassword: password }, seedIp);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email, name: u.name, role, extraPermissions: [], twoFactorEnabled: false, employeeId };
  }
  const managerEmployee = created.find((c) => c.i === 0)!;
  const demoEmployee = created.find((c) => c.i >= DEPTS.length && c.i % DEPTS.length === 0 && c.active)!;
  const workforce = [
    { name: "Team manager", email: "manager@sania.local", role: "TEAM_MANAGER" as const, password: process.env.SEED_MANAGER_PASSWORD ?? pw() },
    { name: "Employee", email: "employee@sania.local", role: "EMPLOYEE" as const, password: process.env.SEED_EMPLOYEE_PASSWORD ?? pw() },
  ];
  const manager = await giveLogin(managerEmployee.id, workforce[0]!.email, "TEAM_MANAGER", workforce[0]!.password);
  const employee = await giveLogin(demoEmployee.id, workforce[1]!.email, "EMPLOYEE", workforce[1]!.password);
  // A few more people with logins so the attendance roster is realistic (passwords never shown).
  const roster = created.filter((c) => c.active && c.id !== managerEmployee.id && c.id !== demoEmployee.id).slice(0, 8);
  for (const c of roster) await giveLogin(c.id, `staff${c.i + 1}@example.invalid`, "EMPLOYEE", pw() + pw());

  // Attendance for the last 10 working days (not today), plus a few people punched in right now.
  const workers = [managerEmployee, demoEmployee, ...roster];
  const sessions: { employeeId: string; workDate: Date; punchInAt: Date; punchOutAt: Date | null; status: "OPEN" | "CLOSED"; durationSeconds: number | null; location: "OFFICE" | "WORK_FROM_HOME" | "CLIENT_VISIT" }[] = [];
  for (let back = 14; back >= 1; back--) {
    const date = addDays(today, -back);
    if (weekdayOf(date) === 0) continue;
    workers.forEach((w, k) => {
      if ((w.i + back) % 9 === 0) return; // occasional absence
      if (w.id === demoEmployee.id && back === 3) return; // a recent gap the demo employee can ask to correct
      const inMin = 9 * 60 + 10 + ((w.i * 7 + back * 11) % 55);
      const outMin = 17 * 60 + 40 + ((w.i * 5 + back * 13) % 80);
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const punchInAt = zonedTimeToUtc(date, hhmm(inMin), tz);
      const punchOutAt = zonedTimeToUtc(date, hhmm(outMin), tz);
      sessions.push({ employeeId: w.id, workDate: new Date(`${date}T00:00:00Z`), punchInAt, punchOutAt, status: "CLOSED", durationSeconds: Math.floor((punchOutAt.getTime() - punchInAt.getTime()) / 1000), location: k % 4 === 3 ? "WORK_FROM_HOME" : "OFFICE" });
    });
  }
  const now = Date.now();
  roster.slice(0, 4).forEach((w, k) => {
    sessions.push({ employeeId: w.id, workDate: new Date(`${today}T00:00:00Z`), punchInAt: new Date(now - (60 + k * 25) * 60_000), punchOutAt: null, status: "OPEN", durationSeconds: null, location: k === 2 ? "CLIENT_VISIT" : "OFFICE" });
  });
  // One forgotten punch-out from two days ago (shows under "Incomplete").
  const forgot = roster[5];
  if (forgot) {
    await db.attendanceSession.deleteMany({ where: { employeeId: forgot.id, workDate: new Date(`${addDays(today, -2)}T00:00:00Z`) } });
  }
  await db.attendanceSession.createMany({ data: sessions.filter((s) => !(forgot && s.employeeId === forgot.id && s.workDate.toISOString().slice(0, 10) === addDays(today, -2))) });
  if (forgot) {
    await db.attendanceSession.create({ data: { employeeId: forgot.id, workDate: new Date(`${addDays(today, -2)}T00:00:00Z`), punchInAt: zonedTimeToUtc(addDays(today, -2), "09:40", tz), status: "OPEN", location: "OFFICE" } });
  }
  const all = await db.attendanceSession.findMany({ select: { id: true, employeeId: true, punchInAt: true, punchOutAt: true, location: true } });
  await db.attendanceEvent.createMany({
    data: all.flatMap((s) => [
      { employeeId: s.employeeId, sessionId: s.id, type: "PUNCH_IN" as const, occurredAt: s.punchInAt, metadata: { location: s.location, seeded: true } },
      ...(s.punchOutAt ? [{ employeeId: s.employeeId, sessionId: s.id, type: "PUNCH_OUT" as const, occurredAt: s.punchOutAt, metadata: { seeded: true } }] : []),
    ]),
  });

  // Tasks from HR (owner) and from the team manager.
  await createTask(db, actor, { title: "Complete the POSH awareness course", description: "Finish the online module and upload your certificate (PDF).", priority: "HIGH", target: "MULTIPLE", employeeIds: [demoEmployee.id, ...roster.slice(0, 3).map((r) => r.id)], dueDate: addDays(today, 5) }, ctx);
  await createTask(db, actor, { title: "Update emergency contact details", priority: "MEDIUM", target: "INDIVIDUAL", employeeIds: [demoEmployee.id], dueDate: addDays(today, -1) }, ctx);
  const teamIds = created.filter((c) => c.active && c.i % DEPTS.length === 0 && c.i !== 0).map((c) => c.id);
  if (teamIds.length) await createTask(db, manager, { title: "Prepare the weekly client report", description: "Summarise placements, interviews scheduled and open requisitions.", priority: "CRITICAL", target: "MULTIPLE", employeeIds: teamIds, dueDate: addDays(today, 2) }, ctx);

  // Leave: one approved casual leave next week, one pending sick leave.
  const { types } = await getMyLeave(db, employee);
  const next = (d: string) => (weekdayOf(d) === 0 ? addDays(d, 1) : d);
  const cl = types.find((t) => t.code === "CL")!;
  const sl = types.find((t) => t.code === "SL")!;
  const approved = await applyLeave(db, employee, { leaveTypeId: cl.id, startDate: next(addDays(today, 8)), endDate: next(addDays(today, 8)), reason: "Family function (demo)" }, ctx);
  await decideLeave(db, actor, approved.id, { decision: "APPROVE" }, ctx);
  await applyLeave(db, employee, { leaveTypeId: sl.id, startDate: next(addDays(today, 12)), endDate: next(addDays(today, 12)), halfDay: "FIRST_HALF", reason: "Doctor appointment (demo)" }, ctx);

  console.log("\nSeeded development data (fictional).");
  console.log("Demo accounts — local development only:");
  for (const a of [...accounts, ...workforce]) console.log(`  ${a.role.padEnd(12)} ${a.email.padEnd(24)} ${a.password}`);
  console.log("\nMFA enforcement for privileged roles is OFF in this local seed. Turn it on in System Rules.\n");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
