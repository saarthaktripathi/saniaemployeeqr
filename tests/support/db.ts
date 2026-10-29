import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import type { Actor, RequestContext } from "@/server/services/context";
import type { Role } from "@/server/authorization/permissions";

export { db };

/** Removes all data between tests. The audit purge flag is required by the append-only trigger. */
export async function resetDb() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.audit_purge = 'on'`;
    await tx.$executeRawUnsafe(
      `TRUNCATE "verification_event", "employee_credential", "employee", "employee_code_counter", "outbox_event", "session", "account", "twoFactor", "verification", "rateLimit", "app_rate_limit" RESTART IDENTITY CASCADE`,
    );
    await tx.auditLog.deleteMany({});
    await tx.user.deleteMany({});
    await tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {
      employeeIdPrefix: "SJB", defaultIdValidityDays: 365, credentialValidityDays: 365, expiryWarningDays: 30,
      publicShowDepartment: true, publicShowJobTitle: true, publicShowBusinessVertical: true, publicShowWorkLocation: true,
      requireMfaForPrivileged: true, auditRetentionDays: 730, verificationRetentionDays: 90,
    } });
  });
}

export async function makeUser(role: Role, extraPermissions: string[] = []): Promise<Actor> {
  const id = randomUUID();
  const email = `${role.toLowerCase()}-${id.slice(0, 8)}@test.local`;
  await db.user.create({ data: { id, name: `${role} user`, email, role, extraPermissions, emailVerified: true } });
  return { id, email, name: `${role} user`, role, extraPermissions, twoFactorEnabled: false };
}

export const ctx: RequestContext = { requestId: "test-request", ipHash: "test-ip" };

export const baseEmployee = {
  firstName: "Asha",
  lastName: "Verma",
  department: "Recruitment",
  jobTitle: "Talent Partner",
  businessVertical: "Staffing",
  workLocation: "Hyderabad",
};
