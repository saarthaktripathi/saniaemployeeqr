"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EXIT_TYPE_LABELS, EXIT_TYPES } from "@/features/employees/labels";

/** Local calendar date as YYYY-MM-DD (the HR user's "today"). */
function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * "Record exit": last working day, exit type and optional reason. The employee becomes
 * inactive, so their QR immediately verifies as "Not a current employee".
 */
export function ExitDialog({ employeeId, name, open, onClose }: { employeeId: string; name: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [exitDate, setExitDate] = useState(localToday);
  const [exitType, setExitType] = useState<string>("RESIGNATION");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
    >
      <form
        method="dialog"
        className="space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/api/employees/${employeeId}/exit`, { body: { exitDate, exitType, reason } });
            toast.success(`Exit recorded for ${name}`);
            onClose();
            router.refresh();
          } catch (err) {
            const message = err instanceof ApiError ? err.message : "Could not record the exit";
            setError(message);
            toast.error(message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            Record exit for {name}?
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            The employee becomes inactive and their QR will show “Not a current employee” to anyone who scans it. The record stays in the directory with its history. Reactivating later records a rejoin.
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exit date (last working day)" htmlFor={`${titleId}-date`} required>
            <Input id={`${titleId}-date`} type="date" value={exitDate} max={localToday()} onChange={(e) => setExitDate(e.target.value)} required />
          </Field>
          <Field label="Exit type" htmlFor={`${titleId}-type`} required>
            <Select id={`${titleId}-type`} value={exitType} onChange={(e) => setExitType(e.target.value)}>
              {EXIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EXIT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason / notes (optional)" htmlFor={`${titleId}-reason`} className="sm:col-span-2">
            <Textarea id={`${titleId}-reason`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!exitDate}>
            Record exit
          </Button>
        </div>
      </form>
    </dialog>
  );
}
