import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

const PORT = 3100;
export const E2E_BASE = `http://localhost:${PORT}`;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/sania_e2e";

// Fixed per-run credentials for the seeded e2e accounts (never used outside the test DB).
process.env.SEED_OWNER_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;
process.env.SEED_HRADMIN_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;
process.env.SEED_HRSTAFF_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;
process.env.SEED_MANAGEMENT_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;
process.env.SEED_MANAGER_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;
process.env.SEED_EMPLOYEE_PASSWORD ??= `E2e-${randomBytes(9).toString("base64url")}`;

// Per-run secrets shared by the server and the seed (seeded QR tokens must decrypt on the server).
// Set once in process.env so the config's re-evaluation in workers reuses the same values.
process.env.E2E_AUTH_SECRET ??= randomBytes(48).toString("base64");
process.env.E2E_CREDENTIAL_KEY ??= randomBytes(32).toString("base64");
process.env.E2E_IP_HASH_SECRET ??= randomBytes(32).toString("base64");
export const E2E_SECRETS = {
  BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET,
  CREDENTIAL_ENCRYPTION_KEY: process.env.E2E_CREDENTIAL_KEY,
  IP_HASH_SECRET: process.env.E2E_IP_HASH_SECRET,
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E_BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${E2E_BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      APP_BASE_URL: E2E_BASE,
      ...E2E_SECRETS,
      LOG_LEVEL: "warn",
    },
  },
});
