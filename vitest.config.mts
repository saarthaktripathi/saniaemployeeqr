import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { randomBytes } from "node:crypto";

const alias = {
  "@": path.resolve(__dirname, "src"),
  // `server-only` throws outside React Server Components; tests run services directly.
  "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
};

// Test-only secrets, generated per run.
const testEnv = {
  NODE_ENV: "test" as const,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/sania_test",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  APP_BASE_URL: "https://verify.example.test",
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  IP_HASH_SECRET: randomBytes(32).toString("base64"),
  LOG_LEVEL: "error",
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    env: testEnv,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/features/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/generated/**", "src/lib/auth-client.ts", "src/lib/api-client.ts"],
      reporter: ["text-summary", "text", "html"],
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "components", include: ["tests/components/**/*.test.tsx"], environment: "jsdom", setupFiles: ["tests/support/jsdom-setup.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts", "tests/security/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          // Tests share one database; run files serially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
