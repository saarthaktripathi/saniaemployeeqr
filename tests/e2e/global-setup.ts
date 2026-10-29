import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DB } from "../../playwright.config";

/** Creates (if needed), migrates, wipes and seeds the isolated e2e database. */
export default async function globalSetup() {
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\/\w*e2e/.test(E2E_DB)) throw new Error(`Refusing to use non-e2e database: ${E2E_DB}`);
  const url = new URL(E2E_DB);
  const dbName = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: E2E_DB };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const c = new Client({ connectionString: E2E_DB });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL app.audit_purge = 'on'");
  await c.query(
    `TRUNCATE "verification_event", "employee_credential", "employee", "employee_code_counter", "outbox_event", "session", "account", "twoFactor", "verification", "rateLimit", "app_rate_limit" RESTART IDENTITY CASCADE`,
  );
  await c.query(`DELETE FROM "audit_log"`);
  await c.query(`DELETE FROM "user"`);
  await c.query("COMMIT");
  await c.end();

  execSync("npx tsx --conditions=react-server prisma/seed.ts", { env: { ...env, SEED_EMPLOYEES: "30" }, stdio: "pipe" });
}
