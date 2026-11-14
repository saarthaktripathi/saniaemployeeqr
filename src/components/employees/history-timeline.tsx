"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Briefcase, Building2, CircleDot, DoorOpen, Laptop, LogIn, MapPin, Plus, StickyNote, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HISTORY_KIND_LABELS, HISTORY_KINDS, type HistoryKind } from "@/features/employees/labels";
import type { HistoryRow } from "@/server/services/history";

const KIND_STYLE: Record<HistoryKind, { icon: typeof Briefcase; tone: string }> = {
  JOINED: { icon: LogIn, tone: "bg-success-50 text-success-700" },
  DESIGNATION: { icon: Briefcase, tone: "bg-primary-50 text-primary-700" },
  DEPARTMENT: { icon: Users, tone: "bg-violet-50 text-violet-600" },
  COMPANY: { icon: Building2, tone: "bg-cyan-50 text-cyan-600" },
  MANAGER: { icon: UserRound, tone: "bg-teal-50 text-teal-700" },
  EMPLOYMENT_TYPE: { icon: CircleDot, tone: "bg-primary-50 text-primary-700" },
  WORK_MODE: { icon: Laptop, tone: "bg-navy-100 text-navy-800" },
  LOCATION: { icon: MapPin, tone: "bg-orange-50 text-orange-700" },
  EXITED: { icon: DoorOpen, tone: "bg-danger-50 text-danger-700" },
  REJOINED: { icon: LogIn, tone: "bg-success-50 text-success-700" },
  NOTE: { icon: StickyNote, tone: "bg-warning-50 text-warning-700" },
};

function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function AddEntry({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<HistoryKind>("DESIGNATION");
  const [effectiveDate, setDate] = useState(localToday);
  const [fromValue, setFrom] = useState("");
  const [toValue, setTo] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 border-b border-border bg-primary-50/30 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          await api(`/api/employees/${employeeId}/history`, { body: { kind, effectiveDate, fromValue, toValue, note } });
          toast.success("History entry added");
          onDone();
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) {
            setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
            toast.error(err.message);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Type of change" htmlFor="h-kind">
        <Select id="h-kind" value={kind} onChange={(e) => setKind(e.target.value as HistoryKind)}>
          {HISTORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {HISTORY_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Effective date" htmlFor="h-date" error={errors.effectiveDate} required>
        <Input id="h-date" type="date" value={effectiveDate} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="From (optional)" htmlFor="h-from" error={errors.fromValue}>
        <Input id="h-from" value={fromValue} maxLength={160} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To / new value" htmlFor="h-to" error={errors.toValue}>
        <Input id="h-to" value={toValue} maxLength={160} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Field label="Note" htmlFor="h-note" error={errors.note} className="sm:col-span-2">
        <Textarea id="h-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Add entry
        </Button>
      </div>
    </form>
  );
}

/**
 * Employment history: automatic entries (joining, designation/department/company/manager
 * changes, exit, rejoin) plus manual entries for history from before the system.
 */
export function HistoryTimeline({ employeeId, rows, canEdit }: { employeeId: string; rows: HistoryRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<HistoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <ConfirmDialog
        open={removing !== null}
        busy={busy}
        options={{ title: "Remove this history entry?", description: "Only manually added entries can be removed. The removal is recorded in the activity log.", confirmLabel: "Remove", tone: "danger" }}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          try {
            await api(`/api/employees/${employeeId}/history/${removing.id}`, { method: "DELETE" });
            toast.success("Entry removed");
            setRemoving(null);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Could not remove the entry");
          } finally {
            setBusy(false);
          }
        }}
      />
      <CardHeader
        eyebrow="Employment history"
        title="Career timeline"
        description="Changes to designation, department, company, manager and status are recorded automatically. Add earlier history manually."
        actions={
          canEdit &&
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Add entry
            </Button>
          )
        }
      />
      {adding && <AddEntry employeeId={employeeId} onDone={() => setAdding(false)} />}
      {rows.length === 0 ? (
        <EmptyState icon={<Briefcase className="size-5" />} title="No history yet" />
      ) : (
        <ol className="relative px-5 py-4" data-testid="history-timeline">
          {rows.map((r, i) => {
            const style = KIND_STYLE[r.kind];
            const Icon = style.icon;
            return (
              <li key={r.id} className="relative flex gap-4 pb-5 last:pb-0">
                {i < rows.length - 1 && <span className="absolute top-9 bottom-0 left-[17px] w-px bg-border" aria-hidden />}
                <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-full", style.tone)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {HISTORY_KIND_LABELS[r.kind]}
                      {r.manual && <Badge dot={false}>Added manually</Badge>}
                    </p>
                    <span className="flex items-center gap-1">
                      <time dateTime={r.effectiveDate} className="text-xs font-medium text-ink-muted tabular-nums">
                        {formatDate(r.effectiveDate)}
                      </time>
                      {canEdit && r.manual && (
                        <button
                          type="button"
                          onClick={() => setRemoving(r)}
                          aria-label={`Remove ${HISTORY_KIND_LABELS[r.kind]} entry`}
                          className="grid size-7 place-items-center rounded-md text-ink-subtle hover:bg-danger-50 hover:text-danger-700"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {(r.fromValue || r.toValue) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                      {r.fromValue && <span className="line-through decoration-ink-subtle/60">{r.fromValue}</span>}
                      {r.fromValue && r.toValue && <ArrowRight className="size-3.5 text-ink-subtle" aria-label="to" />}
                      {r.toValue && <span className="font-medium text-ink">{r.toValue}</span>}
                      {r.fromValue && !r.toValue && <span className="text-ink-subtle">(removed)</span>}
                    </p>
                  )}
                  {r.note && <p className="mt-0.5 text-sm text-ink-muted">{r.note}</p>}
                  {r.createdBy && <p className="mt-0.5 text-xs text-ink-subtle">Recorded by {r.createdBy}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
