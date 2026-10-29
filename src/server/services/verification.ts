import "server-only";
import type { Db } from "@/server/db/client";
import { verificationOutcome, type VerificationStatus } from "@/features/employees/rules";
import { hashToken, isWellFormedToken } from "@/server/security/crypto";
import { enforceRateLimit, RATE_RULES } from "@/server/security/rate-limit";
import { logger } from "@/server/logging/logger";
import type { RequestContext } from "./context";
import { getSettings } from "./settings";

export interface PublicEmployeeView {
  displayName: string;
  employeeCode: string;
  department: string | null;
  jobTitle: string | null;
  businessVertical: string | null;
  workLocation: string | null;
  employmentStatus: "ACTIVE" | "INACTIVE";
  idIssueDate: string;
  idExpiresAt: string;
}

export interface VerificationView {
  status: VerificationStatus | "RATE_LIMITED" | "UNAVAILABLE";
  checkedAt: string;
  company: { name: string; tagline: string };
  employee: PublicEmployeeView | null;
  credentialExpiresAt: string | null;
}

/**
 * Resolves a public verification token to an allow-listed public view.
 * Never returns internal IDs, contact details or audit metadata.
 */
export async function verifyToken(db: Db, token: string, ctx: RequestContext, now = new Date()): Promise<VerificationView> {
  const base = { checkedAt: now.toISOString(), employee: null, credentialExpiresAt: null };
  let company = { name: "Sania Job Bowl", tagline: "Connecting Talent. Creating the Future." };
  try {
    await enforceRateLimit(db, "verify", ctx.ipHash ?? "anonymous", RATE_RULES.verify);
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") return { ...base, company, status: "RATE_LIMITED" };
    logger.error("verification.rate_limit_failed", { requestId: ctx.requestId, err });
    return { ...base, company, status: "UNAVAILABLE" };
  }

  try {
    const settings = await getSettings(db);
    company = { name: settings.companyName, tagline: settings.tagline };
    const wellFormed = isWellFormedToken(token);
    const credential = wellFormed
      ? await db.employeeCredential.findUnique({
          where: { tokenHash: hashToken(token) },
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            employee: {
              select: {
                id: true,
                displayName: true,
                employeeCode: true,
                department: true,
                jobTitle: true,
                businessVertical: true,
                workLocation: true,
                employmentStatus: true,
                archivedAt: true,
                idIssueDate: true,
                idExpiresAt: true,
              },
            },
          },
        })
      : null;
    const employee = credential?.employee ?? null;
    const status = verificationOutcome({ wellFormed, credential, employee }, now);

    await db.verificationEvent.create({
      data: { result: status, credentialId: credential?.id ?? null, employeeId: employee?.id ?? null, ipHash: ctx.ipHash },
    });

    if (!credential || !employee || status === "UNKNOWN" || status === "MALFORMED") return { ...base, company, status };

    // A revoked credential only confirms whose card it was, not their details.
    const minimal = status === "REVOKED";
    return {
      ...base,
      company,
      status,
      credentialExpiresAt: minimal ? null : credential.expiresAt.toISOString(),
      employee: {
        displayName: employee.displayName,
        employeeCode: employee.employeeCode,
        department: !minimal && settings.publicShowDepartment ? employee.department : null,
        jobTitle: !minimal && settings.publicShowJobTitle ? employee.jobTitle : null,
        businessVertical: !minimal && settings.publicShowBusinessVertical ? employee.businessVertical : null,
        workLocation: !minimal && settings.publicShowWorkLocation ? employee.workLocation : null,
        employmentStatus: employee.archivedAt ? "INACTIVE" : employee.employmentStatus,
        idIssueDate: employee.idIssueDate.toISOString().slice(0, 10),
        idExpiresAt: employee.idExpiresAt.toISOString().slice(0, 10),
      },
    };
  } catch (err) {
    logger.error("verification.failed", { requestId: ctx.requestId, err });
    return { ...base, company, status: "UNAVAILABLE" };
  }
}
