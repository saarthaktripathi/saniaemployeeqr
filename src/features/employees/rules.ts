/**
 * Pure business rules for employee lifecycle, ID validity, credential state and
 * public verification outcomes. No I/O — shared by services and unit tests.
 */
import type { StatusAction } from "./schema";

export type EmploymentStatus = "ACTIVE" | "INACTIVE";
export type IdValidity = "VALID" | "EXPIRING_SOON" | "EXPIRED";
export type CredentialState = "VALID" | "EXPIRED" | "REVOKED" | "NONE";

const DAY = 86_400_000;

/** Start of the current UTC calendar day. ID dates are calendar dates stored at UTC midnight. */
export function utcToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

/** An ID is valid through the end of its expiry date (inclusive). */
export function idValidity(idExpiresAt: Date, warnDays: number, now: Date = new Date()): IdValidity {
  const today = utcToday(now);
  if (idExpiresAt < today) return "EXPIRED";
  if (idExpiresAt <= addDays(today, warnDays)) return "EXPIRING_SOON";
  return "VALID";
}

export interface CredentialLike {
  expiresAt: Date;
  revokedAt: Date | null;
}

export function credentialState(cred: CredentialLike | null | undefined, now: Date = new Date()): CredentialState {
  if (!cred) return "NONE";
  if (cred.revokedAt) return "REVOKED";
  if (cred.expiresAt <= now) return "EXPIRED";
  return "VALID";
}

export interface EmployeeStateLike {
  employmentStatus: EmploymentStatus;
  archivedAt: Date | null;
}

export interface TransitionResult {
  employmentStatus: EmploymentStatus;
  archivedAt: Date | null;
  /** Whether the live credential must be revoked as part of the transition. */
  revokeCredential: boolean;
}

/**
 * Validates and applies an employment status transition.
 * Returns null when the transition is not allowed from the current state.
 */
export function applyTransition(current: EmployeeStateLike, action: StatusAction, now: Date = new Date()): TransitionResult | null {
  const archived = current.archivedAt !== null;
  switch (action) {
    case "deactivate":
      if (archived || current.employmentStatus !== "ACTIVE") return null;
      return { employmentStatus: "INACTIVE", archivedAt: null, revokeCredential: false };
    case "reactivate":
      if (archived || current.employmentStatus !== "INACTIVE") return null;
      return { employmentStatus: "ACTIVE", archivedAt: null, revokeCredential: false };
    case "archive":
      if (archived) return null;
      return { employmentStatus: "INACTIVE", archivedAt: now, revokeCredential: true };
    case "unarchive":
      if (!archived) return null;
      // Unarchiving never reactivates; HR must reactivate explicitly.
      return { employmentStatus: "INACTIVE", archivedAt: null, revokeCredential: false };
  }
}

export const ACTION_PERMISSION = {
  deactivate: "employee:deactivate",
  reactivate: "employee:reactivate",
  archive: "employee:archive",
  unarchive: "employee:archive",
} as const satisfies Record<StatusAction, string>;

export type VerificationStatus =
  | "VERIFIED"
  | "INACTIVE"
  | "ID_EXPIRED"
  | "CREDENTIAL_EXPIRED"
  | "REVOKED"
  | "UNKNOWN"
  | "MALFORMED";

/**
 * Decides the public verification result. Order matters: the most serious
 * negative state wins, and VERIFIED is returned only when every check passes.
 */
export function verificationOutcome(
  input: {
    wellFormed: boolean;
    credential: CredentialLike | null;
    employee: (EmployeeStateLike & { idExpiresAt: Date }) | null;
  },
  now: Date = new Date(),
): VerificationStatus {
  if (!input.wellFormed) return "MALFORMED";
  if (!input.credential || !input.employee) return "UNKNOWN";
  if (input.credential.revokedAt) return "REVOKED";
  if (input.employee.archivedAt || input.employee.employmentStatus !== "ACTIVE") return "INACTIVE";
  if (idValidity(input.employee.idExpiresAt, 0, now) === "EXPIRED") return "ID_EXPIRED";
  if (input.credential.expiresAt <= now) return "CREDENTIAL_EXPIRED";
  return "VERIFIED";
}

/** Formats a sequence number into an employee code, e.g. SJB-2026-001 (grows past 999). */
export function formatEmployeeCode(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(3, "0")}`;
}

export function displayNameOf(first: string, last: string, explicit?: string | null): string {
  return (explicit && explicit.trim()) || [first, last].filter(Boolean).join(" ");
}
