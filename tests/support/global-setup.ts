import { execSync } from "node:child_process";

/** Applies migrations to the isolated test database before integration tests. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/sania_test";
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\/\w*test/.test(url)) {
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
