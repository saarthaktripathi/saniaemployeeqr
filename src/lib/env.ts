import "server-only";
import { z } from "zod";

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  APP_BASE_URL: z.string().url(),
  CREDENTIAL_ENCRYPTION_KEY: base64Key32,
  IP_HASH_SECRET: z.string().min(16),
  ERROR_MONITORING_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws (fails fast) on missing/invalid config. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(parsed.data.APP_BASE_URL);
  if (parsed.data.NODE_ENV === "production" && !parsed.data.APP_BASE_URL.startsWith("https://") && !local) {
    throw new Error("APP_BASE_URL must use https:// in production");
  }
  cached = parsed.data;
  return cached;
}

/** Canonical base URL without trailing slash. */
export function baseUrl(): string {
  return env().APP_BASE_URL.replace(/\/+$/, "");
}
