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

async function main() {
  const { db } = await import("@/server/db/client");
  const { createUser } = await import("@/server/services/users");
  const { createEmployee, changeEmployeeStatus } = await import("@/server/services/employees");
  const { issueCredential, revokeCredential } = await import("@/server/services/credentials");
  const { systemContext, systemActor } = await import("@/server/services/context");

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
  ];
  // The system actor creates the owner; everything after is done (and audited) as that owner.
  const owner = await createUser(db, bootstrap, { ...accounts[0], extraPermissions: [] }, ctx);
  const actor = { ...bootstrap, id: owner.id, email: owner.email, name: owner.name };
  for (const a of accounts.slice(1)) await createUser(db, actor, { ...a, extraPermissions: [] }, ctx);

  const count = Number(process.env.SEED_EMPLOYEES ?? 24);
  for (let i = 0; i < count; i++) {
    const [department, jobTitle] = DEPTS[i % DEPTS.length]!;
    const today = new Date();
    const expiry = new Date(today);
    // A mix of validity: most valid, a few expiring soon, a few expired.
    expiry.setUTCDate(expiry.getUTCDate() + (i % 9 === 0 ? -10 : i % 7 === 0 ? 12 : 200 + i * 5));
    const issue = new Date(expiry);
    issue.setUTCFullYear(issue.getUTCFullYear() - 1);
    const emp = await createEmployee(
      db,
      actor,
      {
        firstName: FIRST[i % FIRST.length]!,
        lastName: LAST[i % LAST.length]!,
        department,
        jobTitle,
        businessVertical: VERTICALS[i % VERTICALS.length],
        workLocation: LOCATIONS[i % LOCATIONS.length],
        workEmail: `employee${i + 1}@example.invalid`,
        idIssueDate: issue.toISOString().slice(0, 10),
        idExpiresAt: expiry.toISOString().slice(0, 10),
      },
      ctx,
    );
    if (i % 5 !== 4) {
      const cred = await issueCredential(db, actor, emp.id, ctx);
      if (i % 11 === 10) await revokeCredential(db, actor, cred.id, { reason: "Card reported lost (demo)" }, ctx);
    }
    if (i % 6 === 5) await changeEmployeeStatus(db, actor, emp.id, { action: "deactivate", reason: "Demo: contract ended" }, ctx);
  }

  console.log("\nSeeded development data (fictional).");
  console.log("Demo accounts — local development only:");
  for (const a of accounts) console.log(`  ${a.role.padEnd(9)} ${a.email.padEnd(22)} ${a.password}`);
  console.log("\nMFA enforcement for privileged roles is OFF in this local seed. Turn it on in System Rules.\n");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
