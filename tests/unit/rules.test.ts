import { describe, expect, it } from "vitest";
import {
  addDays,
  applyTransition,
  credentialState,
  displayNameOf,
  formatEmployeeCode,
  idValidity,
  utcToday,
  verificationOutcome,
} from "@/features/employees/rules";

const NOW = new Date("2026-06-15T10:30:00Z");
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("idValidity", () => {
  it("is valid through the end of the expiry date (inclusive)", () => {
    // Expiring today is still usable (not expired), but flagged.
    expect(idValidity(day("2026-06-15"), 0, NOW)).toBe("EXPIRING_SOON");
    expect(idValidity(day("2026-06-16"), 0, NOW)).toBe("VALID");
    expect(idValidity(day("2026-06-14"), 0, NOW)).toBe("EXPIRED");
  });
  it("flags IDs expiring within the warning window", () => {
    expect(idValidity(day("2026-07-15"), 30, NOW)).toBe("EXPIRING_SOON");
    expect(idValidity(day("2026-07-16"), 30, NOW)).toBe("VALID");
    expect(idValidity(day("2026-06-15"), 30, NOW)).toBe("EXPIRING_SOON");
  });
});

describe("credentialState", () => {
  it("reports NONE, REVOKED, EXPIRED and VALID", () => {
    expect(credentialState(null, NOW)).toBe("NONE");
    expect(credentialState({ expiresAt: addDays(NOW, 1), revokedAt: NOW }, NOW)).toBe("REVOKED");
    expect(credentialState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("EXPIRED");
    expect(credentialState({ expiresAt: addDays(NOW, 1), revokedAt: null }, NOW)).toBe("VALID");
  });
  it("revocation wins over expiry", () => {
    expect(credentialState({ expiresAt: addDays(NOW, -5), revokedAt: NOW }, NOW)).toBe("REVOKED");
  });
});

describe("applyTransition", () => {
  const active = { employmentStatus: "ACTIVE" as const, archivedAt: null };
  const inactive = { employmentStatus: "INACTIVE" as const, archivedAt: null };
  const archived = { employmentStatus: "INACTIVE" as const, archivedAt: NOW };

  it("allows the documented transitions", () => {
    expect(applyTransition(active, "deactivate", NOW)).toEqual({ employmentStatus: "INACTIVE", archivedAt: null, revokeCredential: false });
    expect(applyTransition(inactive, "reactivate", NOW)).toEqual({ employmentStatus: "ACTIVE", archivedAt: null, revokeCredential: false });
    expect(applyTransition(active, "archive", NOW)).toEqual({ employmentStatus: "INACTIVE", archivedAt: NOW, revokeCredential: true });
    expect(applyTransition(archived, "unarchive", NOW)).toEqual({ employmentStatus: "INACTIVE", archivedAt: null, revokeCredential: false });
  });

  it("rejects invalid transitions", () => {
    expect(applyTransition(inactive, "deactivate", NOW)).toBeNull();
    expect(applyTransition(active, "reactivate", NOW)).toBeNull();
    expect(applyTransition(archived, "archive", NOW)).toBeNull();
    expect(applyTransition(active, "unarchive", NOW)).toBeNull();
    expect(applyTransition(archived, "reactivate", NOW)).toBeNull();
    expect(applyTransition(archived, "deactivate", NOW)).toBeNull();
  });

  it("never reactivates on unarchive", () => {
    expect(applyTransition({ employmentStatus: "ACTIVE", archivedAt: NOW }, "unarchive", NOW)?.employmentStatus).toBe("INACTIVE");
  });
});

describe("verificationOutcome", () => {
  const cred = { expiresAt: addDays(NOW, 30), revokedAt: null };
  const emp = { employmentStatus: "ACTIVE" as const, archivedAt: null, idExpiresAt: day("2026-12-31") };

  it("returns VERIFIED only when every check passes", () => {
    expect(verificationOutcome({ wellFormed: true, credential: cred, employee: emp }, NOW)).toBe("VERIFIED");
  });
  it("handles malformed and unknown tokens", () => {
    expect(verificationOutcome({ wellFormed: false, credential: cred, employee: emp }, NOW)).toBe("MALFORMED");
    expect(verificationOutcome({ wellFormed: true, credential: null, employee: null }, NOW)).toBe("UNKNOWN");
  });
  it("prioritises revoked > inactive > ID expired > credential expired", () => {
    const expiredEverything = {
      wellFormed: true,
      credential: { expiresAt: addDays(NOW, -1), revokedAt: NOW },
      employee: { employmentStatus: "INACTIVE" as const, archivedAt: null, idExpiresAt: day("2026-01-01") },
    };
    expect(verificationOutcome(expiredEverything, NOW)).toBe("REVOKED");
    expect(verificationOutcome({ ...expiredEverything, credential: { ...expiredEverything.credential, revokedAt: null } }, NOW)).toBe("INACTIVE");
    expect(
      verificationOutcome({ wellFormed: true, credential: { expiresAt: addDays(NOW, -1), revokedAt: null }, employee: { ...emp, idExpiresAt: day("2026-06-14") } }, NOW),
    ).toBe("ID_EXPIRED");
    expect(verificationOutcome({ wellFormed: true, credential: { expiresAt: addDays(NOW, -1), revokedAt: null }, employee: emp }, NOW)).toBe("CREDENTIAL_EXPIRED");
  });
  it("treats archived employees as inactive", () => {
    expect(verificationOutcome({ wellFormed: true, credential: cred, employee: { ...emp, archivedAt: NOW } }, NOW)).toBe("INACTIVE");
  });
});

describe("helpers", () => {
  it("formats employee codes with 3-digit minimum padding", () => {
    expect(formatEmployeeCode("SJB", 2026, 1)).toBe("SJB-2026-001");
    expect(formatEmployeeCode("SJB", 2026, 42)).toBe("SJB-2026-042");
    expect(formatEmployeeCode("SJB", 2026, 1234)).toBe("SJB-2026-1234");
  });
  it("builds display names", () => {
    expect(displayNameOf("Asha", "Verma")).toBe("Asha Verma");
    expect(displayNameOf("Madhavi", "")).toBe("Madhavi");
    expect(displayNameOf("Asha", "Verma", "  Dr. Asha V  ")).toBe("Dr. Asha V");
  });
  it("computes the UTC day", () => {
    expect(utcToday(new Date("2026-06-15T23:59:59Z")).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
});
