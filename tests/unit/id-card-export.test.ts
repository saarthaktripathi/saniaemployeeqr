import { describe, expect, it } from "vitest";
import { CARD_PAGE, jpegToPdf } from "@/lib/pdf-image";
import { cellToText, sheetToCsv } from "@/lib/xlsx-import";
import { encodeCsvForImport, parseCsv, toCsv } from "@/lib/csv";
import { cardStatusOf, STATUS_COPY } from "@/components/verification/status";
import { employeePhotoUrl, photoTypeAllowed } from "@/features/employees/photo";

describe("jpegToPdf", () => {
  it("writes a structurally valid one-page PDF with correct xref offsets", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = jpegToPdf(jpeg, 1080, 1712, CARD_PAGE.width, CARD_PAGE.height);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Width 1080 /Height 1712");
    expect(text).toContain("/MediaBox [0 0 153.07 242.65]");

    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = text.slice(startxref).split("\n").slice(3, 8).map((l) => Number(l.slice(0, 10)));
    const bytes = pdf;
    entries.forEach((offset, i) => {
      const head = new TextDecoder("latin1").decode(bytes.slice(offset, offset + 8));
      expect(head).toBe(`${i + 1} 0 obj\n`);
    });
  });
});

describe("Excel import conversion", () => {
  it("normalises cells: dates to YYYY-MM-DD, numbers and blanks to text", () => {
    expect(cellToText(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01-15");
    expect(cellToText(42)).toBe("42");
    expect(cellToText(null)).toBe("");
    expect(cellToText("  Asha ")).toBe("Asha");
  });

  it("produces CSV the importer parses back, without formula neutralisation", () => {
    const csv = sheetToCsv([
      ["firstName", "phone", "department", "jobTitle", "joiningDate"],
      ["Asha", "+91 98765 43210", "Sales, North", "Lead", new Date(Date.UTC(2026, 2, 1))],
      [null, null, null, null, null],
    ]);
    expect(parseCsv(csv)).toEqual([
      ["firstName", "phone", "department", "jobTitle", "joiningDate"],
      ["Asha", "+91 98765 43210", "Sales, North", "Lead", "2026-03-01"],
    ]);
    // The export path still neutralises formulas.
    expect(toCsv(["a"], [["+1"]])).toContain("'+1");
    expect(encodeCsvForImport([['say "hi"']])).toBe('"say ""hi"""\r\n');
  });
});

describe("public verdicts", () => {
  it("maps every internal status to one of the five public verdicts", () => {
    expect(STATUS_COPY.VERIFIED.verdict).toBe("VALID");
    expect(STATUS_COPY.INACTIVE.verdict).toBe("INACTIVE");
    expect(STATUS_COPY.ID_EXPIRED.verdict).toBe("EXPIRED");
    expect(STATUS_COPY.CREDENTIAL_EXPIRED.verdict).toBe("EXPIRED");
    expect(STATUS_COPY.REVOKED.verdict).toBe("REVOKED");
    expect(STATUS_COPY.UNKNOWN.verdict).toBe("INVALID");
    expect(STATUS_COPY.MALFORMED.verdict).toBe("INVALID");
    expect(cardStatusOf("VERIFIED")).toBe("VALID");
    expect(cardStatusOf("CREDENTIAL_EXPIRED")).toBe("EXPIRED");
    expect(cardStatusOf("REVOKED")).toBe("REVOKED");
    expect(cardStatusOf("INACTIVE")).toBe("INACTIVE");
  });
});

describe("photo helpers", () => {
  it("accepts only JPEG, PNG and WebP and builds cache-busting URLs", () => {
    expect(photoTypeAllowed("image/jpeg")).toBe(true);
    expect(photoTypeAllowed("image/webp")).toBe(true);
    expect(photoTypeAllowed("image/gif")).toBe(false);
    expect(photoTypeAllowed("image/svg+xml")).toBe(false);
    expect(employeePhotoUrl("abc", "2026-11-01T00:00:00.000Z")).toBe("/api/employees/abc/photo?size=thumb&v=1793491200000");
  });
});
