/**
 * Seeds a dedicated load-test database with N fictional employees (fast, set-based SQL),
 * credentials for a sample of them, and one owner account.
 *
 *   LOAD_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sania_load LOAD_EMPLOYEES=10000 npm run seed:load
 *
 * Writes tests/load/results/fixture.json (owner credentials + sample tokens) for run-load.ts.
 * Refuses to run against anything but a local *_load database.
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { Client } from "pg";
import { hash } from "@node-rs/argon2";

const url = process.env.LOAD_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/sania_load";
const N = Number(process.env.LOAD_EMPLOYEES ?? 1000);
const SAMPLE_TOKENS = Math.min(500, N);

if (!/@(localhost|127\.0\.0\.1)(:\d+)?\/\w*load/.test(url)) {
  console.error("Refusing: load seeding only runs against a local *_load database.");
  process.exit(1);
}

async function main() {
  const adminUrl = new URL(url);
  const dbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName])).rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL app.audit_purge = 'on'");
  await c.query(`TRUNCATE "verification_event","employee_credential","employee","employee_code_counter","outbox_event","session","account","twoFactor","verification","rateLimit","app_rate_limit" RESTART IDENTITY CASCADE`);
  await c.query(`DELETE FROM "audit_log"`);
  await c.query(`DELETE FROM "user"`);
  await c.query(`UPDATE "company_settings" SET "requireMfaForPrivileged" = false WHERE id = 1`);

  const ownerId = randomUUID();
  const password = `Load-${randomBytes(9).toString("base64url")}`;
  const pwHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await c.query(`INSERT INTO "user"(id,name,email,"emailVerified",role,"updatedAt") VALUES ($1,'Load Owner','load-owner@sania.local',true,'OWNER',now())`, [ownerId]);
  await c.query(`INSERT INTO "account"(id,"accountId","providerId","userId",password,"updatedAt") VALUES ($1,$2,'credential',$2,$3,now())`, [randomUUID(), ownerId, pwHash]);

  const year = new Date().getUTCFullYear();
  const t0 = Date.now();
  await c.query(
    `INSERT INTO "employee"(id,"employeeCode","firstName","lastName","displayName",department,"jobTitle","businessVertical","workLocation","employmentStatus","idIssueDate","idExpiresAt","updatedAt","createdById","updatedById")
     SELECT gen_random_uuid(),
            'SJB-' || $1 || '-' || CASE WHEN g < 1000 THEN lpad(g::text, 3, '0') ELSE g::text END, -- lpad would truncate 4+ digits
            (ARRAY['Aarav','Diya','Kabir','Meera','Rohan','Ananya','Vihaan','Isha','Arjun','Saanvi'])[1 + g % 10] || g,
            (ARRAY['Sharma','Reddy','Iyer','Khan','Patel','Nair','Gupta','Das'])[1 + g % 8],
            (ARRAY['Aarav','Diya','Kabir','Meera','Rohan','Ananya','Vihaan','Isha','Arjun','Saanvi'])[1 + g % 10] || g || ' ' || (ARRAY['Sharma','Reddy','Iyer','Khan','Patel','Nair','Gupta','Das'])[1 + g % 8],
            (ARRAY['Recruitment','Operations','Client Success','Finance','Technology','Human Resources'])[1 + g % 6],
            'Associate', 'Staffing', 'Hyderabad',
            CASE WHEN g % 7 = 0 THEN 'INACTIVE'::"EmploymentStatus" ELSE 'ACTIVE'::"EmploymentStatus" END,
            current_date - 200, current_date + (g % 400) - 30, now(), $2, $2
     FROM generate_series(1, $3) g`,
    [year, ownerId, N],
  );
  await c.query(`INSERT INTO "employee_code_counter"(prefix,year,"lastValue") VALUES ('SJB',$1,$2)`, [year, N]);

  // Credentials for a sample (token hashes only; tokens kept in the local fixture file).
  const sample = await c.query(`SELECT id FROM "employee" ORDER BY random() LIMIT $1`, [SAMPLE_TOKENS]);
  const tokens: string[] = [];
  for (const row of sample.rows) {
    const token = randomBytes(32).toString("base64url");
    tokens.push(token);
    await c.query(
      `INSERT INTO "employee_credential"(id,"employeeId","tokenHash","expiresAt","issuedById") VALUES (gen_random_uuid(),$1,$2,now() + interval '365 days',$3)`,
      [row.id, createHash("sha256").update(token).digest("hex"), ownerId],
    );
  }
  await c.query("COMMIT");
  await c.query("ANALYZE");
  await c.end();

  fs.mkdirSync("tests/load/results", { recursive: true });
  fs.writeFileSync("tests/load/results/fixture.json", JSON.stringify({ email: "load-owner@sania.local", password, tokens, employees: N }, null, 2));
  console.log(`Seeded ${N} employees and ${tokens.length} credentials in ${Date.now() - t0} ms.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
