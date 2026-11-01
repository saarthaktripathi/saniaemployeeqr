"use client";

import { useRef, useState, type ReactNode } from "react";
import { Download, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CARD_PAGE, jpegToPdf } from "@/lib/pdf-image";

const SCALE = 2; // 1080 × 1712 px output — sharp when printed at card size

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

/** Serialises the card SVG (with images inlined, since an SVG drawn to canvas can't fetch) and rasterises it. */
async function renderCard(svg: SVGSVGElement, background: string): Promise<HTMLCanvasElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  await Promise.all(
    [...clone.querySelectorAll("image")].map(async (img) => {
      const href = img.getAttribute("href");
      if (href && !href.startsWith("data:")) img.setAttribute("href", await toDataUrl(href));
    }),
  );
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

/** Wraps an ID card and offers PNG/PDF download and print. Everything runs in the browser. */
export function IdCardExport({ children, filename, showPrint = true }: { children: ReactNode; filename: string; showPrint?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);

  async function download(kind: "png" | "pdf") {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    setBusy(kind);
    try {
      if (kind === "png") {
        const canvas = await renderCard(svg, "rgba(0,0,0,0)");
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("encode failed");
        save(blob, `${filename}.png`);
      } else {
        // JPEG has no transparency: paint the rounded corners white.
        const canvas = await renderCard(svg, "#ffffff");
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
        if (!blob) throw new Error("encode failed");
        const pdf = jpegToPdf(new Uint8Array(await blob.arrayBuffer()), canvas.width, canvas.height, CARD_PAGE.width, CARD_PAGE.height);
        save(new Blob([pdf as BlobPart], { type: "application/pdf" }), `${filename}.pdf`);
      }
      toast.success(`ID card downloaded as ${kind.toUpperCase()}`);
    } catch {
      toast.error("Download failed. Try again, or use Print → Save as PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div ref={ref} className="print-card">
        {children}
      </div>
      <div className="no-print mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => download("png")} loading={busy === "png"} disabled={busy !== null}>
          <Download className="size-4" aria-hidden /> PNG
        </Button>
        <Button variant="secondary" size="sm" onClick={() => download("pdf")} loading={busy === "pdf"} disabled={busy !== null}>
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
