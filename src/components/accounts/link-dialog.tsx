"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/cn";

/**
 * Shows a one-time link (invitation or password reset). The server stores only a hash, so the
 * link cannot be shown again after this dialog closes.
 */
export function LinkDialog({ link, title, expiresAt, onClose }: { link: string | null; title: string; expiresAt?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (link && !d.open) {
      setCopied(false);
      d.showModal();
    }
    if (!link && d.open) d.close();
  }, [link]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Send this link privately to the person (for example by WhatsApp or SMS). It works once{expiresAt ? ` and expires ${formatDateTime(expiresAt)}` : ""}. It
          will not be shown again.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={link ?? ""}
            aria-label="One-time link"
            data-testid="one-time-link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border-strong bg-page px-3 font-mono text-xs text-ink"
          />
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </dialog>
  );
}
