"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Pending {
  ids: string[];
  label: string;
  description?: string;
}

/**
 * Confirm → permanently delete one or many employees → toast → refresh.
 * Pass `redirectTo` when the current page shows a record that will no longer exist.
 */
export function useDeleteAction({ onDone, redirectTo }: { onDone?: () => void; redirectTo?: string } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const request = (ids: string[], label: string, description?: string) => setPending({ ids, label, description });

  const dialog = pending ? (
    <ConfirmDialog
      open
      busy={busy}
      options={{
        title: `Delete ${pending.label}?`,
        tone: "danger",
        confirmLabel: "Delete permanently",
        reasonLabel: "Reason (recorded in the audit log)",
        reasonRequired: true,
        description:
          pending.description ??
          "This permanently removes the record and its QR credentials. Any printed QR will show “Invalid”. This cannot be undone — archive instead if you may need the record later.",
      }}
      onCancel={() => setPending(null)}
      onConfirm={async (reason) => {
        setBusy(true);
        try {
          const res = await api<{ deleted: number }>("/api/employees/delete", { body: { ids: pending.ids, reason } });
          toast.success(res.deleted === 1 ? `${pending.label} deleted` : `${res.deleted} employees deleted`);
          setPending(null);
          onDone?.();
          if (redirectTo) router.replace(redirectTo);
          else router.refresh();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Delete failed");
        } finally {
          setBusy(false);
        }
      }}
    />
  ) : null;

  return { request, dialog };
}
