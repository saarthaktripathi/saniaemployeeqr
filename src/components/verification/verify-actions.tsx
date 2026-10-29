"use client";

import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function VerifyActions({ url }: { url: string }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Verification link copied");
          } catch {
            toast.error("Could not copy — select and copy the address bar instead");
          }
        }}
      >
        <Copy className="size-4" aria-hidden /> Copy verification URL
      </Button>
      <Button variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden /> Print-friendly view
      </Button>
    </div>
  );
}
