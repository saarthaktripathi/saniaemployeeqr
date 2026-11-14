"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/cn";
import { formatLongDate } from "@/lib/time";
import { HALF_DAY_LABELS, HALF_DAYS, LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, type LeaveStatus } from "@/features/leave/schema";
import type { getMyLeave } from "@/server/services/leave";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";

type Data = Awaited<ReturnType<typeof getMyLeave>>;

function ApplyForm({ data }: { data: Data }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(data.types[0]?.id ?? "");
  const [startDate, setStart] = useState(data.today);
  const [endDate, setEnd] = useState(data.today);
  const [halfDay, setHalfDay] = useState<(typeof HALF_DAYS)[number]>("NONE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const type = data.types.find((t) => t.id === typeId);
  const single = startDate === endDate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await api<{ leave: { days: number } }>("/api/me/leave", { body: { leaveTypeId: typeId, startDate, endDate, halfDay: single ? halfDay : "NONE", reason } });
      toast.success(`Leave requested (${res.leave.days} day${res.leave.days === 1 ? "" : "s"}). HR has been notified.`);
      setReason("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        if (err.details?.field) setErrors((x) => ({ ...x, [String(err.details!.field)]: err.message }));
        toast.error(err.fields[0]?.message ?? err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Apply for leave" description="Weekly offs and holidays inside your dates are not counted." />
      <form onSubmit={submit} className="space-y-4 p-5" data-testid="leave-form">
        <Field label="Leave type" htmlFor="leave-type" error={errors.leaveTypeId}>
          <Select id="leave-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {data.balances.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.remaining === null ? "" : ` (${b.remaining} left)`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="leave-start" error={errors.startDate}>
            <Input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStart(e.target.value);
                if (endDate < e.target.value) setEnd(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="To" htmlFor="leave-end" error={errors.endDate}>
            <Input id="leave-end" type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
        </div>
        {single && type?.allowHalfDay && (
          <Field label="Duration" htmlFor="leave-half" error={errors.halfDay}>
            <Select id="leave-half" value={halfDay} onChange={(e) => setHalfDay(e.target.value as (typeof HALF_DAYS)[number])}>
              {HALF_DAYS.map((h) => (
                <option key={h} value={h}>
                  {h === "NONE" ? "Full day" : HALF_DAY_LABELS[h]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Reason" htmlFor="leave-reason" error={errors.reason} required>
          <Textarea id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required className="min-h-20" />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3 || !typeId}>
            <CalendarPlus className="size-4" aria-hidden /> Submit request
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Employee leave page body: balances, application form and request history with actions. */
export function MyLeave({ data }: { data: Data }) {
  const router = useRouter();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="leave-balances">
        {data.balances.map((b) => (
          <Card key={b.id} className="p-4">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{b.name}</p>
            <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{b.remaining === null ? "∞" : b.remaining}</p>
            <p className="text-xs text-ink-subtle">
              {b.annualQuota === null ? "No yearly limit" : `of ${b.annualQuota} in ${data.year}`} · used {b.used}
              {b.pending ? ` · ${b.pending} pending` : ""}
            </p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <ApplyForm data={data} />
        </div>
        <Card className="min-w-0">
          <CardHeader title="My requests" />
          {data.requests.length === 0 ? (
            <EmptyState title="No leave requests yet" />
          ) : (
            <ul className="divide-y divide-border" data-testid="my-leave-requests">
              {data.requests.map((r) => {
                const cancellable = r.status === "PENDING" || r.status === "CLARIFICATION" || (r.status === "APPROVED" && r.startDate > data.today);
                return (
                  <li key={r.id} className="space-y-2 px-5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          {r.leaveType.name} · {r.days} day{r.days === 1 ? "" : "s"}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {formatLongDate(r.startDate)}
                          {r.endDate !== r.startDate ? ` – ${formatLongDate(r.endDate)}` : ""}
                          {r.halfDay !== "NONE" ? ` (${HALF_DAY_LABELS[r.halfDay]})` : ""}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          {r.reason} · applied {formatDateTime(r.createdAt)}
                        </p>
                      </div>
                      <Badge tone={LEAVE_STATUS_TONES[r.status as LeaveStatus]}>{LEAVE_STATUS_LABELS[r.status as LeaveStatus]}</Badge>
                    </div>
                    {r.reviewNote && (
                      <p className="rounded-lg bg-navy-100/50 px-3 py-2 text-sm text-ink">
                        <span className="font-medium">HR{r.reviewer ? ` (${r.reviewer})` : ""}:</span> {r.reviewNote}
                      </p>
                    )}
                    {r.status === "CLARIFICATION" && (
                      <form
                        className="flex gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await run(`reply-${r.id}`, () => api(`/api/me/leave/${r.id}/respond`, { body: { note: reply[r.id] ?? "" } }), "Reply sent to HR")) setReply((x) => ({ ...x, [r.id]: "" }));
                        }}
                      >
                        <label htmlFor={`reply-${r.id}`} className="sr-only">
                          Reply to HR
                        </label>
                        <Input id={`reply-${r.id}`} value={reply[r.id] ?? ""} onChange={(e) => setReply((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="Reply to HR's question" maxLength={500} />
                        <Button type="submit" size="md" loading={busy === `reply-${r.id}`} disabled={(reply[r.id] ?? "").trim().length < 3}>
                          Reply
                        </Button>
                      </form>
                    )}
                    {cancellable && (
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setCancelId(r.id)}>
                          Cancel request
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={cancelId !== null}
        options={{ title: "Cancel this leave request?", description: "If it was already approved, HR is told it was cancelled.", confirmLabel: "Cancel request", tone: "danger" }}
        busy={busy === "cancel"}
        onCancel={() => setCancelId(null)}
        onConfirm={async () => {
          if (await run("cancel", () => api(`/api/me/leave/${cancelId}`, { method: "DELETE" }), "Leave request cancelled")) setCancelId(null);
        }}
      />
    </div>
  );
}
