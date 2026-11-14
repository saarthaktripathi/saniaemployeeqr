import { describe, expect, it } from "vitest";
import { bulkStatusSchema, employeeCreateFormSchema, employeeCreateSchema, employeeEditFormSchema, employeeListQuerySchema, employeeUpdateSchema, exitSchema } from "@/features/employees/schema";
import { companyCreateSchema, companyUpdateSchema, compensationCreateSchema, documentMetaSchema, documentTypeAllowed, historyEntrySchema } from "@/features/directory/schema";
import { patchEnum, patchText, patchUrl, patchUuid } from "@/features/shared/schema";
import { EMPLOYMENT_TYPES } from "@/features/employees/labels";
import { safeFileName, sniffDocumentType } from "@/server/services/documents";
import { settingsUpdateSchema } from "@/features/settings/schema";
import { userCreateSchema } from "@/features/users/schema";

const valid = { firstName: "Asha", department: "Recruitment", jobTitle: "Talent Partner" };

describe("employee form schemas", () => {
  // The shared create/edit form carries every field (as strings); the strict API schema would
  // reject the edit-only ones with an error that no field displays, silently blocking "Create".
  const formValues = {
    ...valid,
    lastName: "",
    displayName: "",
    workEmail: "",
    phone: "",
    companyId: "",
    businessVertical: "",
    employmentType: "FULL_TIME",
    workMode: "OFFICE",
    workLocation: "",
    team: "",
    reportingManagerId: "",
    attendanceRef: "",
    leavePolicy: "",
    leaveSystemUrl: "",
    joiningDate: "",
    idIssueDate: "",
    idExpiresAt: "",
    employmentStatus: "ACTIVE",
    exitDate: "",
    exitType: "",
    exitReason: "",
  };

  it("validates the full create form, ignoring edit-only fields", () => {
    expect(employeeCreateSchema.safeParse(formValues).success).toBe(false);
    expect(employeeCreateFormSchema.safeParse(formValues).success).toBe(true);
  });

  it("validates the full edit form when no exit is recorded", () => {
    const r = employeeEditFormSchema.safeParse({ ...formValues, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01" });
    expect(r.success).toBe(true);
  });
});

describe("employeeCreateSchema", () => {
  it("accepts a minimal record and normalises optional fields", () => {
    const r = employeeCreateSchema.parse(valid);
    expect(r).toMatchObject({ firstName: "Asha", lastName: "", workEmail: null, phone: null, joiningDate: null, idIssueDate: null });
  });

  it("trims, lowercases email and parses dates", () => {
    const r = employeeCreateSchema.parse({ ...valid, firstName: "  Asha ", workEmail: " Asha@Example.COM ", joiningDate: "2026-02-28" });
    expect(r.firstName).toBe("Asha");
    expect(r.workEmail).toBe("asha@example.com");
    expect(r.joiningDate?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("rejects unknown keys (mass assignment)", () => {
    for (const key of ["employmentStatus", "employeeCode", "id", "archivedAt", "createdById", "version"]) {
      expect(employeeCreateSchema.safeParse({ ...valid, [key]: "x" }).success).toBe(false);
    }
  });

  it("rejects missing required fields, oversize input and control characters", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, department: "x".repeat(81) }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, firstName: "A\u0000b" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, jobTitle: "line\nbreak" }).success).toBe(false);
  });

  it("rejects invalid dates and reversed ranges", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, joiningDate: "2026-02-30" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, joiningDate: "15/02/2026" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, idIssueDate: "2026-05-01", idExpiresAt: "2026-04-01" }).success).toBe(false);
  });

  it("keeps HTML as inert text (escaping happens at render)", () => {
    const r = employeeCreateSchema.parse({ ...valid, firstName: "<script>alert(1)</script>" });
    expect(r.firstName).toBe("<script>alert(1)</script>");
  });

  it("validates email and phone formats", () => {
    expect(employeeCreateSchema.safeParse({ ...valid, workEmail: "not-an-email" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...valid, phone: "+91 98765 43210" }).success).toBe(true);
  });
});

describe("employeeUpdateSchema", () => {
  it("requires a version and both ID dates", () => {
    expect(employeeUpdateSchema.safeParse({ ...valid, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01" }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ ...valid, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01", version: 1 }).success).toBe(true);
  });
});

describe("employeeListQuerySchema", () => {
  it("applies defaults and bounds", () => {
    expect(employeeListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, status: "ALL", sort: "createdAt", dir: "desc" });
    expect(employeeListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ sort: "password" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("bounds bulk operations", () => {
    expect(bulkStatusSchema.safeParse({ ids: [], action: "deactivate" }).success).toBe(false);
    const ids = Array.from({ length: 201 }, () => "00000000-0000-4000-8000-000000000000");
    expect(bulkStatusSchema.safeParse({ ids, action: "deactivate" }).success).toBe(false);
  });
  it("validates settings", () => {
    expect(settingsUpdateSchema.safeParse({ employeeIdPrefix: "sjb" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ employeeIdPrefix: "SJB" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ auditRetentionDays: 10 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ unknown: true }).success).toBe(false);
  });
  it("enforces password length for new users", () => {
    expect(userCreateSchema.safeParse({ name: "A", email: "a@b.co", role: "HR_STAFF", password: "short" }).success).toBe(false);
    expect(userCreateSchema.safeParse({ name: "A", email: "a@b.co", role: "HR_STAFF", password: "long-enough-pass" }).success).toBe(true);
  });
});

describe("directory fields", () => {
  it("accepts friendly spellings for employment type and work mode", () => {
    const e = patchEnum(EMPLOYMENT_TYPES);
    expect(e.parse("Full-time")).toBe("FULL_TIME");
    expect(e.parse(" part time ")).toBe("PART_TIME");
    expect(e.parse("intern")).toBe("INTERN");
    expect(e.parse("")).toBeNull();
    expect(e.parse(undefined)).toBeUndefined();
    const bad = e.safeParse("Permanent");
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/FULL_TIME/);
    expect(employeeCreateSchema.parse({ ...valid, employmentType: "Contract", workMode: "hybrid" })).toMatchObject({ employmentType: "CONTRACT", workMode: "HYBRID" });
    expect(employeeCreateSchema.safeParse({ ...valid, workMode: "Moon" }).success).toBe(false);
  });

  it("uses patch semantics: absent stays undefined, empty clears", () => {
    const t = patchText(80);
    expect(t.parse(undefined)).toBeUndefined();
    expect(t.parse("")).toBeNull();
    expect(t.parse(null)).toBeNull();
    expect(t.parse("  Talent Squad ")).toBe("Talent Squad");
    expect(t.safeParse("a\nb").success).toBe(false);
    expect(patchUuid.parse(undefined)).toBeUndefined();
    expect(patchUuid.parse("")).toBeNull();
    expect(patchUuid.safeParse("not-a-uuid").success).toBe(false);
    const r = employeeCreateSchema.parse(valid);
    expect(r.team).toBeUndefined();
    expect(r.companyId).toBeUndefined();
    expect(r.reportingManagerId).toBeUndefined();
  });

  it("only allows http(s) links for the leave system", () => {
    expect(patchUrl.parse("https://hr.example.com/leave/42")).toBe("https://hr.example.com/leave/42");
    expect(patchUrl.parse("http://intranet.local/leave")).toBe("http://intranet.local/leave");
    expect(patchUrl.parse("")).toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.y/z", "hr.example.com", "https://a b.com"]) {
      expect(patchUrl.safeParse(bad).success).toBe(false);
    }
    expect(patchUrl.safeParse(`https://x.com/${"a".repeat(500)}`).success).toBe(false);
  });

  it("accepts new list filters and rejects unknown values", () => {
    const q = employeeListQuerySchema.parse({ status: "EXITED", type: "INTERN", mode: "REMOTE", designation: "Analyst", sort: "joiningDate" });
    expect(q).toMatchObject({ status: "EXITED", type: "INTERN", mode: "REMOTE", designation: "Analyst", company: "", manager: "" });
    expect(employeeListQuerySchema.safeParse({ company: "x" }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ manager: "'; drop" }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ type: "SLAVE" }).success).toBe(false);
  });

  it("validates exit details", () => {
    expect(exitSchema.parse({ exitDate: "2026-03-31", exitType: "RESIGNATION" })).toMatchObject({ exitType: "RESIGNATION", reason: null });
    expect(exitSchema.safeParse({ exitDate: "31/03/2026", exitType: "RESIGNATION" }).success).toBe(false);
    expect(exitSchema.safeParse({ exitDate: "2026-03-31", exitType: "FIRED" }).success).toBe(false);
    expect(exitSchema.safeParse({ exitDate: "2026-03-31", exitType: "OTHER", status: "ACTIVE" }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ ...valid, idIssueDate: "2026-01-01", idExpiresAt: "2027-01-01", version: 1, exitType: "retirement" }).data?.exitType).toBe("RETIREMENT");
  });
});

describe("directory record schemas", () => {
  it("parses compensation amounts without floating point", () => {
    const base = { type: "SALARY", frequency: "MONTHLY", effectiveFrom: "2026-04-01" };
    expect(compensationCreateSchema.parse({ ...base, amount: "1,20,000.50" })).toMatchObject({ amount: "120000.50", currency: "INR" });
    expect(compensationCreateSchema.parse({ ...base, amount: 45000, currency: "usd" })).toMatchObject({ amount: "45000", currency: "USD" });
    for (const amount of ["-5", "12.345", "abc", "", "1e5", "1234567890123"]) {
      expect(compensationCreateSchema.safeParse({ ...base, amount }).success).toBe(false);
    }
    expect(compensationCreateSchema.safeParse({ ...base, amount: "1", currency: "RUPEES" }).success).toBe(false);
    expect(compensationCreateSchema.safeParse({ ...base, amount: "1", type: "BONUS" }).success).toBe(false);
    expect(compensationCreateSchema.safeParse({ ...base, amount: "1", employeeId: "x" }).success).toBe(false);
  });

  it("requires a new value or a note on manual history entries", () => {
    expect(historyEntrySchema.safeParse({ kind: "DESIGNATION", effectiveDate: "2024-01-01" }).success).toBe(false);
    expect(historyEntrySchema.safeParse({ kind: "DESIGNATION", effectiveDate: "2024-01-01", toValue: "Senior Analyst" }).success).toBe(true);
    expect(historyEntrySchema.safeParse({ kind: "NOTE", effectiveDate: "2024-01-01", note: "Sabbatical" }).success).toBe(true);
    expect(historyEntrySchema.safeParse({ kind: "PROMOTION", effectiveDate: "2024-01-01", note: "x" }).success).toBe(false);
  });

  it("validates company names and codes", () => {
    expect(companyCreateSchema.parse({ name: " Sania Tech ", code: "stl" })).toEqual({ name: "Sania Tech", code: "STL" });
    expect(companyCreateSchema.parse({ name: "Sania Tech", code: "" })).toEqual({ name: "Sania Tech", code: null });
    expect(companyCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ name: "X", code: "S" }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ name: "X", code: "TOO-LONG!" }).success).toBe(false);
    expect(companyUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false, code: undefined });
  });

  it("validates document metadata and types", () => {
    expect(documentMetaSchema.safeParse({ category: "OFFER_LETTER", title: "Offer", fileName: "offer.pdf" }).success).toBe(true);
    expect(documentMetaSchema.safeParse({ category: "SELFIE", title: "x", fileName: "x.pdf" }).success).toBe(false);
    expect(documentMetaSchema.safeParse({ category: "OTHER", title: "", fileName: "x.pdf" }).success).toBe(false);
    expect(documentTypeAllowed("application/pdf")).toBe(true);
    expect(documentTypeAllowed("text/html")).toBe(false);
    expect(documentTypeAllowed("image/svg+xml")).toBe(false);
  });

  it("detects document types by content and sanitises file names", () => {
    expect(sniffDocumentType(Buffer.from("%PDF-1.7\n%..."))).toBe("application/pdf");
    expect(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffDocumentType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffDocumentType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffDocumentType(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffDocumentType(Buffer.alloc(0))).toBeNull();

    expect(safeFileName(String.raw`C:\Users\hr\Offer Letter.pdf`, "application/pdf")).toBe("Offer Letter.pdf");
    expect(safeFileName("../../etc/passwd", "application/pdf")).toBe("passwd.pdf");
    expect(safeFileName('evil".html', "image/png")).toBe("evil.png");
    expect(safeFileName("scan.jpeg", "image/png")).toBe("scan.png");
    expect(safeFileName("", "image/jpeg")).toBe("document.jpg");
    expect(safeFileName("a\u0000b<c>.pdf", "application/pdf")).toBe("abc.pdf");
  });
});
