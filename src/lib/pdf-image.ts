/**
 * Builds a one-page PDF that contains a single JPEG image filling the page.
 * Dependency-free: JPEG data is embedded as-is (DCTDecode), so no re-encoding happens.
 * Sizes are in PDF points (1/72 inch).
 */
export function jpegToPdf(jpeg: Uint8Array, imgWidth: number, imgHeight: number, pageWidth: number, pageHeight: number): Uint8Array {
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
  const w = pageWidth.toFixed(2);
  const h = pageHeight.toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
    push(jpeg);
    push("\nendstream");
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** CR80 ID card (54 × 85.6 mm) in PDF points, portrait. */
export const CARD_PAGE = { width: (54 / 25.4) * 72, height: (85.6 / 25.4) * 72 };
