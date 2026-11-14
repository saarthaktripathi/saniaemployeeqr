"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/cn";
import { formatClock, formatLongDate } from "@/lib/time";
import { CORRECTION_LABELS } from "@/features/attendance/schema";
import type { CorrectionRow } from "@/server/services/attendance-corrections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Badge, EmptyState } from "@/components/ui/primitives";

const TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = { PENDING: "warning", APPLIED: "success", REJECTED: "danger", CANCELLED: "neutral" };
const LABEL: Record<string, string> = { PENDING: "Pending", APPLIED: "Applied", REJECTED: "Rejected", CANCELLED: "Withdrawn" };

function Times({ v, tz }: { v: unknown; tz: string }) {
  const s = v as { punchInAt?: string; punchOutAt?: string | null; status?: string } | null;
  if (!s?.punchInAt) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="tabular-nums">
      {formatClock(s.punchInAt, tz)}–{s.punchOutAt ? formatClock(s.punchOutAt, tz) : "open"}
      {s.status === "VOIDED" ? " (removed)" : ""}
    </span>
  );
}

/** Correction requests and the audit trail of applied/rejected ones (before → after). */
export function CorrectionQueue({ items, canManage, timezone }: { items: CorrectionRow[]; canManage: boolean; timezone: string }) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function review(id: string, decision: "APPLY" | "REJECT") {
    setBusy(`${id}-${decision}`);
    try {
      await api(`/api/attendance/corrections/${id}`, { body: { decision, ...(note[id]?.trim() ? { note: note[id] } : {}) } });
      toast.success(decision === "APPLY" ? "Correction applied" : "Request rejected");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <EmptyState title="Nothing here" description="Correction requests from employees and corrections made by HR appear here." />;
  return (
    <ul className="divide-y divide-border" data-testid="correction-queue">
      {items.map((c) => (
        <li key={c.id} className="space-y-2 px-4 py-4" data-testid="correction-row" data-status={c.status}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                <Link href={`/attendance/employees/${c.employeeId}?month=${c.workDate.slice(0, 7)}`} className="hover:text-primary-600">
                  {c.employeeName}
                </Link>{" "}
                <span className="text-xs font-normal text-ink-subtle">{c.employeeCode}</span>
              </p>
              <p className="text-sm text-ink">
                {CORRECTION_LABELS[c.kind as keyof typeof CORRECTION_LABELS]} · {formatLongDate(c.workDate)}
              </p>
              <p className="text-sm text-ink-muted">“{c.reason}”</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {c.status === "PENDING" ? (
                  <>
                    Requested: <Times v={{ punchInAt: c.punchInAt, punchOutAt: c.punchOutAt }} tz={timezone} />
                  </>
                ) : c.status === "APPLIED" ? (
                  <>
                    Before <Times v={c.before} tz={timezone} /> → after <Times v={c.after} tz={timezone} />
                  </>
                ) : null}
              </p>
              <p className="text-xs text-ink-subtle">
                By {c.requestedBy ?? "—"} · {formatDateTime(c.createdAt)}
                {c.reviewedBy && c.status !== "PENDING" ? ` · reviewed by ${c.reviewedBy}${c.reviewNote ? `: ${c.reviewNote}` : ""}` : ""}
              </p>
            </div>
            <Badge tone={TONE[c.status] ?? "neutral"}>{LABEL[c.status] ?? c.status}</Badge>
          </div>
          {c.status === "PENDING" && canManage && (
            <div className="flex flex-col gap-2 rounded-xl bg-page p-3 sm:flex-row sm:items-center">
              <label htmlFor={`cnote-${c.id}`} className="sr-only">
                Note
              </label>
              <Input id={`cnote-${c.id}`} value={note[c.id] ?? ""} onChange={(e) => setNote((x) => ({ ...x, [c.id]: e.target.value }))} placeholder="Note (required to reject)" maxLength={300} />
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="danger" loading={busy === `${c.id}-REJECT`} disabled={!note[c.id]?.trim()} onClick={() => review(c.id, "REJECT")}>
                  Reject
                </Button>
                <Button size="sm" variant="success" loading={busy === `${c.id}-APPLY`} onClick={() => review(c.id, "APPLY")} data-testid="apply-correction">
                  Apply
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
