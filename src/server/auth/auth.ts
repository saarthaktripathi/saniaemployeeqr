import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { db } from "@/server/db/client";
import { baseUrl, env } from "@/lib/env";
import { hashIp } from "@/server/security/crypto";
import { recordAudit } from "@/server/services/audit";
import { logger } from "@/server/logging/logger";
import { hashPassword, verifyPassword } from "./password";
import { clientIpFromHeaders } from "./request";

const SESSION_HOURS = 8;

function createAuth() {
  return betterAuth({
    appName: "Sania Job Bowl",
    baseURL: baseUrl(),
    secret: env().BETTER_AUTH_SECRET,
    trustedOrigins: [baseUrl()],
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by owners only (see server/services/users.ts).
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "HR_STAFF" },
        isActive: { type: "boolean", required: false, input: false, defaultValue: true },
        extraPermissions: { type: "string[]", required: false, input: false, defaultValue: [] },
      },
    },
    session: {
      expiresIn: SESSION_HOURS * 3600,
      updateAge: 3600,
      freshAge: 15 * 60,
    },
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT_DISABLED !== "1",
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env().NODE_ENV === "production",
      cookiePrefix: "sjb",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      session: {
        create: {
          // Disabled accounts cannot obtain sessions even with a valid password.
          before: async (session) => {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { isActive: true } });
            if (!user?.isActive) return false;
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email" && ctx.path !== "/two-factor/verify-totp" && ctx.path !== "/sign-out") return;
        try {
          const ip = clientIpFromHeaders(ctx.headers ?? new Headers());
          const reqCtx = { requestId: ctx.headers?.get("x-request-id") ?? "auth", ipHash: hashIp(ip) };
          const newSession = ctx.context.newSession;
          if (ctx.path === "/sign-out") return;
          if (newSession) {
            const u = newSession.user as { id: string; role?: string };
            await recordAudit(db, reqCtx, {
              actor: { id: u.id, role: (u.role ?? "HR_STAFF") as "HR_STAFF" },
              action: ctx.path === "/sign-in/email" ? "auth.login.success" : "auth.mfa.success",
              targetType: "user",
              targetId: u.id,
            });
            return;
          }
          const returned = ctx.context.returned as { twoFactorRedirect?: boolean } | undefined;
          if (returned && typeof returned === "object" && "twoFactorRedirect" in returned) {
            return; // Password accepted; MFA challenge pending. Logged on MFA completion.
          }
          const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase().slice(0, 254) : null;
          const user = email ? await db.user.findUnique({ where: { email }, select: { id: true, role: true } }) : null;
          await recordAudit(db, reqCtx, {
            actor: user ? { id: user.id, role: user.role } : null,
            action: ctx.path === "/sign-in/email" ? "auth.login.failure" : "auth.mfa.failure",
            targetType: "user",
            targetId: user?.id,
            outcome: "FAILURE",
            // Do not record unknown emails (avoids storing typos/third-party addresses).
            metadata: { knownAccount: Boolean(user) },
          });
        } catch (err) {
          logger.error("auth.audit_failed", { err });
        }
      }),
    },
    plugins: [twoFactor({ issuer: "Sania Job Bowl" }), nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

declare global {
  var __auth: Auth | undefined;
}

/** Lazily constructed so builds don't require runtime secrets. */
export function getAuth(): Auth {
  if (!globalThis.__auth) globalThis.__auth = createAuth();
  return globalThis.__auth;
}
