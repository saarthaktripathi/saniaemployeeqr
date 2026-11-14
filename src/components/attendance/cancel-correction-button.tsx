"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function CancelCorrectionButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/me/attendance/corrections/${id}`, { method: "DELETE" });
          toast.success("Request withdrawn");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Could not withdraw the request");
        } finally {
          setBusy(false);
        }
      }}
    >
      Withdraw
    </Button>
  );
}
