import { describe, expect, it } from "vitest";
import { CARD_PAGE, imagesToPdf, jpegToPdf, mmToPt } from "@/lib/pdf-image";
import { clip, fitSize, textWidth } from "@/components/cards/text-metrics";
import { visitingCardData } from "@/components/cards/visiting-card-svg";
import { BRAND_CONTACT } from "@/lib/brand";
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

describe("imagesToPdf", () => {
  it("writes one page per card side, each with its own size and orientation", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = imagesToPdf([
      { jpeg, width: 1080, height: 1712, pageWidth: mmToPt(54), pageHeight: mmToPt(85.6) },
      { jpeg, width: 1712, height: 1080, pageWidth: mmToPt(85.6), pageHeight: mmToPt(54) },
    ]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text).toContain("/Kids [3 0 R 6 0 R] /Count 2");
    expect(text).toContain("/MediaBox [0 0 153.07 242.65]");
    expect(text).toContain("/MediaBox [0 0 242.65 153.07]");
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(startxref).split("\n").slice(3, 11).map((l) => Number(l.slice(0, 10)));
    expect(entries).toHaveLength(8);
    entries.forEach((offset, i) => expect(new TextDecoder("latin1").decode(pdf.slice(offset, offset + 8))).toBe(`${i + 1} 0 obj\n`));
  });
});

describe("card text fitting", () => {
  it("measures Urbanist widths and shrinks long text to fit", () => {
    // Chromium measures the kerned string at 483.5px; the per-glyph sum may only over-estimate (never overflow), by under 2%.
    const hello = textWidth("Hello World", 100, 400);
    expect(hello).toBeGreaterThanOrEqual(483.5);
    expect(hello).toBeLessThan(483.5 * 1.02);
    expect(textWidth("AB", 10, 800)).toBeGreaterThan(textWidth("AB", 10, 400));
    expect(fitSize(["MEERA", "RAO"], 468, 64, 800)).toBe(64);
    const long = fitSize(["VENKATASUBRAMANIAN"], 468, 64, 800);
    expect(long).toBeLessThan(64);
    expect(textWidth("VENKATASUBRAMANIAN", long, 800)).toBeLessThanOrEqual(468.5);
    expect(clip("a.very.long.address@saniajobbowl.com", 200, 28, 500)).toMatch(/…$/);
    expect(clip("short", 200, 28, 500)).toBe("short");
  });
});

describe("visitingCardData", () => {
  it("uses the employee's contacts and falls back to the company's", () => {
    const full = visitingCardData({ displayName: "Asha Rao", jobTitle: "Recruiter", phone: "+91 90000 00000", workEmail: "asha@saniajobbowl.com", workLocation: "Hyderabad" });
    expect(full).toMatchObject({ phone: "+91 90000 00000", email: "asha@saniajobbowl.com", location: "Hyderabad, India", website: BRAND_CONTACT.website });
    const bare = visitingCardData({ displayName: "Ravi", jobTitle: null, phone: null, workEmail: " ", workLocation: "Remote — India" });
    expect(bare).toMatchObject({ phone: BRAND_CONTACT.phone, email: BRAND_CONTACT.email, location: BRAND_CONTACT.city });
    expect(visitingCardData({ ...bare, phone: null, workEmail: null, workLocation: "Pune, India" }).location).toBe("Pune, India");
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
