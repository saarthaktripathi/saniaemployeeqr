"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Minus, Plus, RotateCcw, Trash2, Undo2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, initials } from "@/lib/cn";
import { PHOTO_MIN_SIDE, PHOTO_SIZE, photoTypeAllowed } from "@/features/employees/photo";

/** Originals are compressed in the browser before upload, so larger camera files are fine here. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const VIEW = 224; // crop viewport (px)
const MAX_ZOOM = 3;

export type PhotoChange = { kind: "keep" } | { kind: "remove" } | { kind: "set"; render: () => Promise<Blob> };

interface Source {
  url: string;
  img: HTMLImageElement;
  w: number;
  h: number;
  name: string;
}

interface Crop {
  zoom: number;
  x: number;
  y: number;
}

function clampCrop(c: Crop, s: Source): Crop {
  const scale = (VIEW / Math.min(s.w, s.h)) * c.zoom;
  const dw = s.w * scale;
  const dh = s.h * scale;
  return { zoom: c.zoom, x: Math.min(0, Math.max(VIEW - dw, c.x)), y: Math.min(0, Math.max(VIEW - dh, c.y)) };
}

function centered(s: Source, zoom = 1): Crop {
  const scale = (VIEW / Math.min(s.w, s.h)) * zoom;
  return { zoom, x: (VIEW - s.w * scale) / 2, y: (VIEW - s.h * scale) / 2 };
}

/** Draws the visible square to a PHOTO_SIZE canvas and encodes it (WebP, JPEG fallback). */
async function renderCrop(s: Source, c: Crop): Promise<Blob> {
  const scale = (VIEW / Math.min(s.w, s.h)) * c.zoom;
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s.img, -c.x / scale, -c.y / scale, VIEW / scale, VIEW / scale, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("Could not encode the photo");
  return jpeg;
}

/** PUT with upload progress (fetch has no upload progress events). */
export function uploadEmployeePhoto(employeeId: string, blob: Blob, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/employees/${employeeId}/photo`);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "Photo upload failed";
      try {
        message = JSON.parse(xhr.responseText)?.error?.message ?? message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading the photo"));
    xhr.send(blob);
  });
}

export async function deleteEmployeePhoto(employeeId: string): Promise<void> {
  const res = await fetch(`/api/employees/${employeeId}/photo`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not remove the photo");
}

function loadImage(file: File): Promise<Source> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, img, w: img.naturalWidth, h: img.naturalHeight, name: file.name });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file could not be read as an image"));
    };
    img.src = url;
  });
}

/**
 * Employee photo picker: drag & drop or browse, validation, circular crop with drag and zoom,
 * replace/remove. Reports the pending change to the form via `onChange`; the form uploads
 * after the employee record is saved.
 */
export function PhotoUpload({ name, existingUrl, onChange, disabled, progress }: { name: string; existingUrl: string | null; onChange: (c: PhotoChange) => void; disabled?: boolean; progress?: number | null }) {
  const [source, setSource] = useState<Source | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Free the object URL when the source changes or the component unmounts.
  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);

  useEffect(() => {
    if (source) onChange({ kind: "set", render: () => renderCrop(source, crop) });
    else onChange(removed ? { kind: "remove" } : { kind: "keep" });
  }, [source, crop, removed, onChange]);

  const pick = useCallback(async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!photoTypeAllowed(file.type)) return setError("Use a JPEG, PNG or WebP image.");
    if (file.size > MAX_SOURCE_BYTES) return setError("This image is larger than 15 MB. Choose a smaller file.");
    try {
      const s = await loadImage(file);
      if (Math.min(s.w, s.h) < PHOTO_MIN_SIDE) {
        URL.revokeObjectURL(s.url);
        return setError(`The image is too small (${s.w}×${s.h}). Use at least ${PHOTO_MIN_SIDE}×${PHOTO_MIN_SIDE} pixels.`);
      }
      setSource(s);
      setCrop(centered(s));
      setRemoved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the image.");
    }
  }, []);

  const setZoom = (zoom: number) => {
    if (!source) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
    const oldScale = (VIEW / Math.min(source.w, source.h)) * crop.zoom;
    const newScale = (VIEW / Math.min(source.w, source.h)) * z;
    // Zoom around the centre of the viewport.
    const cx = (VIEW / 2 - crop.x) / oldScale;
    const cy = (VIEW / 2 - crop.y) / oldScale;
    setCrop(clampCrop({ zoom: z, x: VIEW / 2 - cx * newScale, y: VIEW / 2 - cy * newScale }, source));
  };

  const nudge = (dx: number, dy: number) => source && setCrop((c) => clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, source));

  const scale = source ? (VIEW / Math.min(source.w, source.h)) * crop.zoom : 1;
  const showExisting = !source && !removed && existingUrl;

  return (
    <div className="space-y-3" data-testid="photo-upload">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id="photo-file"
        aria-label="Employee photo"
        disabled={disabled}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {source ? (
        <div className="space-y-3">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Photo position. Drag, or use arrow keys to move; plus and minus to zoom."
            aria-valuemin={1}
            aria-valuemax={MAX_ZOOM}
            aria-valuenow={Number(crop.zoom.toFixed(2))}
            className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-full bg-navy-100 ring-4 ring-primary-100 select-none active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setCrop((c) => clampCrop({ ...c, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, source));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 5;
              const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
              if (moves[e.key]) {
                e.preventDefault();
                nudge(...moves[e.key]);
              } else if (e.key === "+" || e.key === "=") setZoom(crop.zoom + 0.1);
              else if (e.key === "-") setZoom(crop.zoom - 0.1);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img
              src={source.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left will-change-transform"
              style={{ width: source.w, height: source.h, transform: `translate3d(${crop.x}px, ${crop.y}px, 0) scale(${scale})` }}
            />
          </div>
          <div className="mx-auto flex max-w-[260px] items-center gap-2">
            <button type="button" onClick={() => setZoom(crop.zoom - 0.2)} aria-label="Zoom out" className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-navy-100">
              <Minus className="size-4" aria-hidden />
            </button>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="h-1.5 flex-1 accent-primary-600"
            />
            <button type="button" onClick={() => setZoom(crop.zoom + 0.2)} aria-label="Zoom in" className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-navy-100">
              <Plus className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setCrop(centered(source))} aria-label="Reset position" className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-navy-100">
              <RotateCcw className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-center text-xs text-ink-subtle">Drag to reposition · scroll or use the slider to zoom</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={disabled}>
              <ImageUp className="size-4" aria-hidden /> Replace
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSource(null)} disabled={disabled}>
              <Undo2 className="size-4" aria-hidden /> {existingUrl ? "Keep current photo" : "Discard"}
            </Button>
          </div>
        </div>
      ) : showExisting ? (
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
          <img src={existingUrl} alt={`Current photo of ${name || "employee"}`} width={VIEW} height={VIEW} className="mx-auto size-40 rounded-full object-cover ring-4 ring-primary-100" />
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={disabled}>
              <ImageUp className="size-4" aria-hidden /> Replace photo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRemoved(true)} disabled={disabled}>
              <Trash2 className="size-4 text-danger-700" aria-hidden /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void pick(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragOver ? "border-primary-500 bg-primary-50" : "border-border-strong bg-page/60",
          )}
        >
          <span className="relative grid size-24 place-items-center rounded-full bg-gradient-to-br from-navy-100 to-primary-100 text-2xl font-semibold text-navy-800">
            {name.trim() ? initials(name) : <Camera className="size-8 text-navy-700/60" aria-hidden />}
            <span className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary-500 to-violet-600 text-white shadow">
              <UploadCloud className="size-4" aria-hidden />
            </span>
          </span>
          <div>
            <p className="text-sm font-medium text-ink">{removed ? "Photo will be removed when you save" : "Drag a photo here"}</p>
            <p className="text-xs text-ink-subtle">JPEG, PNG or WebP · at least {PHOTO_MIN_SIDE}×{PHOTO_MIN_SIDE} px</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={disabled}>
              <ImageUp className="size-4" aria-hidden /> Browse files
            </Button>
            {removed && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setRemoved(false)}>
                <Undo2 className="size-4" aria-hidden /> Undo
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-xs font-medium text-danger-700" data-testid="photo-error">
          {error}
        </p>
      )}
      {progress != null && (
        <div className="space-y-1" role="progressbar" aria-label="Photo upload" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 overflow-hidden rounded-full bg-navy-100">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-primary-600 transition-[width] duration-150" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-center text-xs text-ink-subtle">Uploading photo… {progress}%</p>
        </div>
      )}
    </div>
  );
}
