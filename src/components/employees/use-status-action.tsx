"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { ConfirmDialog, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import type { StatusAction } from "@/features/employees/schema";

const COPY: Record<StatusAction, Omit<ConfirmOptions, "title"> & { verb: string; done: string }> = {
  deactivate: {
    verb: "Deactivate",
    done: "deactivated",
    confirmLabel: "Deactivate",
    tone: "danger",
    reasonLabel: "Reason (recorded in the audit log)",
    description: "Their QR credential will immediately show “Inactive employee” to anyone who scans it. You can reactivate later.",
  },
  reactivate: {
    verb: "Reactivate",
    done: "reactivated",
    confirmLabel: "Reactivate",
    tone: "primary",
    reasonLabel: "Reason (optional)",
    description: "The employee will verify as active again (if their ID and QR are still valid).",
  },
  archive: {
    verb: "Archive",
    done: "archived",
    confirmLabel: "Archive",
    tone: "danger",
    reasonLabel: "Reason (recorded in the audit log)",
    reasonRequired: true,
    description: "The record is hidden from the directory, set inactive, and its QR credential is revoked. History is kept.",
  },
  unarchive: {
    verb: "Unarchive",
    done: "restored (inactive)",
    confirmLabel: "Unarchive",
    tone: "primary",
    description: "The record returns to the directory as inactive. Reactivate and issue a new QR separately if needed.",
  },
};

interface Pending {
  action: StatusAction;
  ids: string[];
  label: string;
}

/** Confirm → POST status change → toast → refresh. Works for one or many employees. */
export function useStatusAction(onDone?: () => void) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const request = useCallback((action: StatusAction, ids: string[], label: string) => setPending({ action, ids, label }), []);

  const dialog = pending ? (
    <ConfirmDialog
      open
      busy={busy}
      options={{ ...COPY[pending.action], title: `${COPY[pending.action].verb} ${pending.label}?` }}
      onCancel={() => setPending(null)}
      onConfirm={async (reason) => {
        setBusy(true);
        try {
          if (pending.ids.length === 1) {
            await api(`/api/employees/${pending.ids[0]}/status`, { body: { action: pending.action, reason: reason || null } });
          } else {
            await api(`/api/employees/bulk`, { body: { ids: pending.ids, action: pending.action, reason: reason || null } });
          }
          toast.success(`${pending.label} ${COPY[pending.action].done}`);
          setPending(null);
          onDone?.();
          router.refresh();
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Action failed");
        } finally {
          setBusy(false);
        }
      }}
    />
  ) : null;

  return { request, dialog };
}
