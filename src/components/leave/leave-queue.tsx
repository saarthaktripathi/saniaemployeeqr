"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/cn";
import { formatLongDate } from "@/lib/time";
import { HALF_DAY_LABELS, LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, type LeaveStatus } from "@/features/leave/schema";
import type { LeaveRequestView } from "@/server/services/leave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

/** HR leave queue rows with approve / reject / ask-for-clarification. */
export function LeaveQueue({ items, canDecide }: { items: LeaveRequestView[]; canDecide: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVE" | "REJECT" | "CLARIFY") {
    setBusy(`${id}-${decision}`);
    try {
      await api(`/api/leave/${id}/decision`, { body: { decision, ...(note[id]?.trim() ? { note: note[id] } : {}) } });
      toast.success(decision === "APPROVE" ? "Leave approved" : decision === "REJECT" ? "Leave rejected" : "Clarification requested");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <EmptyState title="No leave requests here" description="New requests appear here as soon as employees submit them." />;
  return (
    <ul className="divide-y divide-border" data-testid="leave-queue">
      {items.map((r) => {
        const open = r.status === "PENDING" || r.status === "CLARIFICATION";
        return (
          <li key={r.id} className="space-y-3 px-4 py-4" data-testid="leave-row" data-status={r.status}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <EmployeeAvatar id={r.employeeId} name={r.employeeName} photoUpdatedAt={r.photoUpdatedAt} />
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {r.employeeName} <span className="text-xs font-normal text-ink-subtle">{r.employeeCode} · {r.department}</span>
                  </p>
                  <p className="text-sm text-ink">
                    {r.leaveType.name} · <span className="font-semibold">{r.days} day{r.days === 1 ? "" : "s"}</span> · {formatLongDate(r.startDate)}
                    {r.endDate !== r.startDate ? ` – ${formatLongDate(r.endDate)}` : ""}
                    {r.halfDay !== "NONE" ? ` (${HALF_DAY_LABELS[r.halfDay]})` : ""}
                  </p>
                  <p className="text-sm text-ink-muted">“{r.reason}”</p>
                  {r.employeeNote && <p className="mt-1 text-sm text-ink">Employee replied: {r.employeeNote}</p>}
                  {r.reviewNote && (
                    <p className="mt-1 text-xs text-ink-subtle">
                      HR note{r.reviewer ? ` (${r.reviewer})` : ""}: {r.reviewNote}
                    </p>
                  )}
                  <p className="text-xs text-ink-subtle">Applied {formatDateTime(r.createdAt)}</p>
                </div>
              </div>
              <Badge tone={LEAVE_STATUS_TONES[r.status as LeaveStatus]}>{LEAVE_STATUS_LABELS[r.status as LeaveStatus]}</Badge>
            </div>
            {open && canDecide && (
              <div className="flex flex-col gap-2 rounded-xl bg-page p-3 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`note-${r.id}`} className="mb-1 block text-xs font-medium text-ink-muted">
                    Note to the employee (required to reject or ask a question)
                  </label>
                  <Textarea id={`note-${r.id}`} value={note[r.id] ?? ""} onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))} maxLength={500} className="min-h-12" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status === "PENDING" && (
                    <Button size="sm" variant="secondary" loading={busy === `${r.id}-CLARIFY`} disabled={!note[r.id]?.trim()} onClick={() => decide(r.id, "CLARIFY")}>
                      Ask a question
                    </Button>
                  )}
                  <Button size="sm" variant="danger" loading={busy === `${r.id}-REJECT`} disabled={!note[r.id]?.trim()} onClick={() => decide(r.id, "REJECT")}>
                    Reject
                  </Button>
                  <Button size="sm" variant="success" loading={busy === `${r.id}-APPROVE`} onClick={() => decide(r.id, "APPROVE")} data-testid="approve-leave">
                    Approve
                  </Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
