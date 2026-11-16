"use client";

import { useRef, useState, type ReactNode } from "react";
import { Download, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BRAND_FONT_URL } from "@/lib/brand";
import { imagesToPdf, mmToPt, type PdfImagePage } from "@/lib/pdf-image";

const SCALE = 2; // e.g. 1080 × 1712 px for an ID card side — sharp when printed at card size

async function toDataUrl(href: string): Promise<string> {
  const res = await fetch(href, { credentials: "same-origin" });
  if (!res.ok) throw new Error("image fetch failed");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

let fontCss: Promise<string> | null = null;
/** @font-face rule with Urbanist inlined: an SVG drawn to a canvas cannot load web fonts itself. */
function brandFontCss(): Promise<string> {
  fontCss ??= toDataUrl(BRAND_FONT_URL)
    .then((url) => `@font-face{font-family:"Urbanist";font-weight:100 900;src:url(${url}) format("woff2");}`)
    .catch(() => {
      fontCss = null;
      return "";
    });
  return fontCss;
}

/** Serialises a card SVG (with images and the brand font inlined) and rasterises it. */
async function renderCard(svg: SVGSVGElement, background: string): Promise<HTMLCanvasElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  await Promise.all(
    [...clone.querySelectorAll("image")].map(async (img) => {
      const href = img.getAttribute("href");
      if (href && !href.startsWith("data:")) img.setAttribute("href", await toDataUrl(href));
    }),
  );
  const css = await brandFontCss();
  if (css) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  const [, , w, h] = (clone.getAttribute("viewBox") ?? "0 0 540 856").split(" ").map(Number);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function save(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Printed size of a card side from its data-card-mm attribute ("54x85.6"). */
function cardPage(svg: SVGSVGElement) {
  const [wMm, hMm] = (svg.dataset.cardMm ?? "54x85.6").split("x").map(Number);
  return { pageWidth: mmToPt(wMm!), pageHeight: mmToPt(hMm!) };
}

/**
 * Wraps one or more card SVGs (each marked with data-card-mm and data-card-label) and offers PNG
 * downloads per side, a single PDF with every side at its printed size, and print.
 * Everything runs in the browser.
 */
export function CardExport({
  children,
  filename,
  sides,
  noun = "Card",
  showPrint = true,
  className,
}: {
  children: ReactNode;
  filename: string;
  /** Labels of the card sides in document order, e.g. ["Front", "Back"]; one side shows a plain "PNG" button. */
  sides: string[];
  noun?: string;
  showPrint?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const svgs = () => [...(ref.current?.querySelectorAll<SVGSVGElement>("svg[data-card-mm]") ?? [])];

  async function downloadPng(index: number) {
    const svg = svgs()[index];
    if (!svg) return;
    setBusy(`png${index}`);
    try {
      const canvas = await renderCard(svg, "rgba(0,0,0,0)");
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("encode failed");
      const suffix = sides.length > 1 ? `-${sides[index]!.toLowerCase()}` : "";
      save(blob, `${filename}${suffix}.png`);
      toast.success(`${noun} downloaded as PNG`);
    } catch {
      toast.error("Download failed. Try again, or use Print → Save as PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setBusy("pdf");
    try {
      const pages: PdfImagePage[] = [];
      for (const svg of svgs()) {
        // JPEG has no transparency: paint the rounded corners white.
        const canvas = await renderCard(svg, "#ffffff");
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
        if (!blob) throw new Error("encode failed");
        pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, ...cardPage(svg) });
      }
      if (!pages.length) return;
      save(new Blob([imagesToPdf(pages) as BlobPart], { type: "application/pdf" }), `${filename}.pdf`);
      toast.success(`${noun} downloaded as PDF`);
    } catch {
      toast.error("Download failed. Try again, or use Print → Save as PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div ref={ref} className={className}>
        {children}
      </div>
      <div className="no-print mt-5 flex flex-wrap justify-center gap-2">
        {sides.map((side, i) => (
          <Button key={side} variant="secondary" size="sm" onClick={() => downloadPng(i)} loading={busy === `png${i}`} disabled={busy !== null}>
            <Download className="size-4" aria-hidden /> {sides.length > 1 ? `${side} PNG` : "PNG"}
          </Button>
        ))}
        <Button variant="secondary" size="sm" onClick={downloadPdf} loading={busy === "pdf"} disabled={busy !== null}>
          <FileDown className="size-4" aria-hidden /> PDF
        </Button>
        {showPrint && (
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        )}
      </div>
    </div>
  );
}
