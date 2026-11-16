export interface PdfImagePage {
  jpeg: Uint8Array;
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Page size in PDF points (1/72 inch); the image fills the page. */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Builds a PDF with one JPEG image filling each page (pages may differ in size and orientation).
 * Dependency-free: JPEG data is embedded as-is (DCTDecode), so no re-encoding happens.
 */
export function imagesToPdf(pages: readonly PdfImagePage[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.byteLength;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  // Objects: 1 catalog, 2 page tree, then per page: page, image, content stream.
  const pageObj = (i: number) => 3 + i * 3;
  const count = 2 + pages.length * 3;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((page, i) => {
    const n = pageObj(i);
    const w = page.pageWidth.toFixed(2);
    const h = page.pageHeight.toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`));
    obj(n + 1, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`);
      push(page.jpeg);
      push("\nendstream");
    });
    obj(n + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });

  const xref = length;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= count; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Builds a one-page PDF containing a single JPEG image filling the page. */
export function jpegToPdf(jpeg: Uint8Array, imgWidth: number, imgHeight: number, pageWidth: number, pageHeight: number): Uint8Array {
  return imagesToPdf([{ jpeg, width: imgWidth, height: imgHeight, pageWidth, pageHeight }]);
}

/** Millimetres to PDF points. */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/** CR80 ID card (54 × 85.6 mm) in PDF points, portrait. */
export const CARD_PAGE = { width: mmToPt(54), height: mmToPt(85.6) };
