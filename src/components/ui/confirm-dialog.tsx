"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Textarea } from "./form";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  /** When set, asks for a reason (required if `reasonRequired`). */
  reasonLabel?: string;
  reasonRequired?: boolean;
}

/**
 * Accessible confirmation built on the native <dialog> element (focus trap,
 * Escape to close, inert background).
 */
export function ConfirmDialog({
  open,
  options,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  options: ConfirmOptions;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const titleId = useId();
  const reasonId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const needsReason = Boolean(options.reasonRequired);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (needsReason && !reason.trim()) return;
          onConfirm(reason.trim());
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {options.title}
        </h2>
        {options.description && <div className="mt-2 text-sm text-ink-muted">{options.description}</div>}
        {options.reasonLabel && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="mb-1.5 block text-sm font-medium">
              {options.reasonLabel}
              {needsReason && <span className="text-danger-700"> *</span>}
            </label>
            <Textarea id={reasonId} value={reason} maxLength={300} required={needsReason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={options.tone === "danger" ? "danger" : "primary"} loading={busy} disabled={needsReason && !reason.trim()}>
            {options.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
