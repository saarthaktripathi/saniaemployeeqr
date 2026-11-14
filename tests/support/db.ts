import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import type { Actor, RequestContext } from "@/server/services/context";
import type { Role } from "@/server/authorization/permissions";

export { db };

const DEFAULT_COMPANY = "Sania Job Bowl";

/**
 * Removes all data between tests. The audit purge flag is required by the append-only trigger.
 * Exactly one active company ("Sania Job Bowl") is kept, as after the directory migration.
 */
export async function resetDb() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.audit_purge = 'on'`;
    await tx.$executeRawUnsafe(
      `TRUNCATE "verification_event", "employee_credential", "employee_compensation", "employee_document_blob", "employee_document", "employment_history", "employee", "employee_code_counter", "outbox_event", "session", "account", "twoFactor", "verification", "rateLimit", "app_rate_limit" RESTART IDENTITY CASCADE`,
    );
    await tx.auditLog.deleteMany({});
    await tx.user.deleteMany({});
    // Prefer the company created by the migration (its createdAt is in the DB server's local
    // time, so ordering by createdAt alone is not reliable on non-UTC servers).
    const keep =
      (await tx.company.findFirst({ where: { name: DEFAULT_COMPANY }, select: { id: true } })) ??
      (await tx.company.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }));
    if (keep) {
      await tx.company.deleteMany({ where: { id: { not: keep.id } } });
      await tx.company.update({ where: { id: keep.id }, data: { name: DEFAULT_COMPANY, code: "SJB", isActive: true } });
    } else {
      await tx.company.create({ data: { name: DEFAULT_COMPANY, code: "SJB" } });
    }
    await tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {
      employeeIdPrefix: "SJB", defaultIdValidityDays: 365, credentialValidityDays: 365, expiryWarningDays: 30,
      publicShowDepartment: true, publicShowJobTitle: true, publicShowBusinessVertical: true, publicShowWorkLocation: true,
      publicShowPhoto: true, requireMfaForPrivileged: true, auditRetentionDays: 730, verificationRetentionDays: 90,
    } });
  });
}

export async function makeUser(role: Role, extraPermissions: string[] = []): Promise<Actor> {
  const id = randomUUID();
  const email = `${role.toLowerCase()}-${id.slice(0, 8)}@test.local`;
  await db.user.create({ data: { id, name: `${role} user`, email, role, extraPermissions, emailVerified: true } });
  return { id, email, name: `${role} user`, role, extraPermissions, twoFactorEnabled: false };
}

/** Adds another (active) group company directly in the database. */
export async function makeCompany(name: string, code?: string): Promise<{ id: string; name: string }> {
  return db.company.create({ data: { name, code: code ?? null }, select: { id: true, name: true } });
}

/** The company kept by resetDb(). Tests must not rename it to something else and then call this. */
export async function defaultCompanyId(): Promise<string> {
  const c = await db.company.findFirstOrThrow({ where: { code: "SJB" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return c.id;
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
