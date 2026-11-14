"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatClock } from "@/lib/time";
import { CORRECTION_KINDS, CORRECTION_LABELS, LOCATION_LABELS, LOCATIONS } from "@/features/attendance/schema";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export interface CorrectionSession {
  id: string;
  workDate: string;
  punchInAt: string;
  punchOutAt: string | null;
  status: string;
  location: string;
}

type Kind = (typeof CORRECTION_KINDS)[number];

/**
 * Attendance correction form. Employees request (HR reviews); HR with attendance:manage applies
 * directly (`employeeId` set). Times are local HH:MM on the work date; the server converts them.
 */
export function CorrectionDialog({
  open,
  onClose,
  employeeId,
  date,
  sessions,
  timezone,
  initialKind,
  initialSessionId,
}: {
  open: boolean;
  onClose: () => void;
  /** Set for HR direct corrections; omitted for employee requests. */
  employeeId?: string;
  date: string;
  sessions: CorrectionSession[];
  timezone: string;
  initialKind?: Kind;
  initialSessionId?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const editable = sessions.filter((s) => s.status !== "VOIDED");
  const [kind, setKind] = useState<Kind>(initialKind ?? (editable.length ? "CHANGE_TIMES" : "ADD_SESSION"));
  const [sessionId, setSessionId] = useState(initialSessionId ?? editable[0]?.id ?? "");
  const [workDate, setWorkDate] = useState(date);
  const [punchIn, setPunchIn] = useState("");
  const [punchOut, setPunchOut] = useState("");
  const [location, setLocation] = useState("OFFICE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Several dialogs can exist on one page (one per day): ids must be unique so labels stay attached.
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      const s = editable.find((x) => x.id === (initialSessionId ?? editable[0]?.id));
      setKind(initialKind ?? (editable.length ? "CHANGE_TIMES" : "ADD_SESSION"));
      setSessionId(s?.id ?? "");
      setWorkDate(date);
      setPunchIn(s ? formatClock(s.punchInAt, timezone) : "09:30");
      setPunchOut(s?.punchOutAt ? formatClock(s.punchOutAt, timezone) : "18:30");
      setReason("");
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const needsSession = kind !== "ADD_SESSION";
  const showIn = kind === "ADD_SESSION" || kind === "CHANGE_TIMES";
  const showOut = kind !== "VOID_SESSION";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      kind,
      workDate,
      reason,
      ...(needsSession ? { sessionId } : {}),
      ...(showIn ? { punchIn } : {}),
      ...(showOut ? { punchOut } : {}),
      ...(kind === "ADD_SESSION" ? { location } : {}),
      ...(employeeId ? { employeeId } : {}),
    };
    try {
      await api(employeeId ? "/api/attendance/corrections" : "/api/me/attendance/corrections", { body });
      toast.success(employeeId ? "Attendance corrected" : "Correction requested. HR will review it.");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Could not save the correction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={id("title")}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
    >
      <form onSubmit={submit} className="space-y-4 p-5" data-testid="correction-form">
        <div>
          <h2 id={id("title")} className="text-lg font-semibold">
            {employeeId ? "Correct attendance" : "Request a correction"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {employeeId ? "The change is applied immediately and recorded with before/after values." : "HR reviews your request. Times are in your company's time zone."}
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        <Field label="What needs fixing?" htmlFor={id("kind")}>
          <Select id={id("kind")} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {CORRECTION_KINDS.filter((k) => k === "ADD_SESSION" || editable.length > 0)
              .filter((k) => k !== "CLOSE_SESSION" || editable.some((s) => s.status === "OPEN"))
              .map((k) => (
                <option key={k} value={k}>
                  {CORRECTION_LABELS[k]}
                </option>
              ))}
          </Select>
        </Field>
        {needsSession ? (
          <Field label="Session" htmlFor={id("session")}>
            <Select id={id("session")} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {editable
                .filter((s) => kind !== "CLOSE_SESSION" || s.status === "OPEN")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.workDate} · {formatClock(s.punchInAt, timezone)}–{s.punchOutAt ? formatClock(s.punchOutAt, timezone) : "open"} · {LOCATION_LABELS[s.location as keyof typeof LOCATION_LABELS] ?? s.location}
                  </option>
                ))}
            </Select>
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor={id("date")}>
              <Input id={id("date")} type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required />
            </Field>
            <Field label="Location" htmlFor={id("loc")}>
              <Select id={id("loc")} value={location} onChange={(e) => setLocation(e.target.value)}>
                {LOCATIONS.map((l) => (
                  <option key={l} value={l}>
                    {LOCATION_LABELS[l]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {(showIn || showOut) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {showIn && (
              <Field label="Punch in" htmlFor={id("in")}>
                <Input id={id("in")} type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} required />
              </Field>
            )}
            {showOut && (
              <Field label="Punch out" htmlFor={id("out")} hint="Earlier than punch-in means the next day">
                <Input id={id("out")} type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} required />
              </Field>
            )}
          </div>
        )}
        <Field label="Reason" htmlFor={id("reason")} required>
          <Textarea id={id("reason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required placeholder="e.g. Forgot to punch out; left at 6:30 pm" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3 || (needsSession && !sessionId)}>
            {employeeId ? "Apply correction" : "Send request"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** Button that opens the correction dialog (client island for server pages). */
export function CorrectionButton({ label = "Request correction", variant = "secondary", size = "sm", ...props }: Omit<Parameters<typeof CorrectionDialog>[0], "open" | "onClose"> & { label?: string; variant?: "secondary" | "primary" | "ghost"; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <CorrectionDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
