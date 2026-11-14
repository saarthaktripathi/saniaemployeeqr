"use client";

import { useCallback, useState } from "react";
import { EyeOff, IndianRupee, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { COMPENSATION_TYPE_LABELS, COMPENSATION_TYPES, PAY_FREQUENCIES, PAY_FREQUENCY_LABELS } from "@/features/employees/labels";
import type { CompensationRow } from "@/server/services/compensation";

function money(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function AddRevision({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [type, setType] = useState("SALARY");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [effectiveFrom, setEffective] = useState(localToday);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4 border-b border-border bg-primary-50/30 p-5 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          await api(`/api/employees/${employeeId}/compensation`, { body: { type, amount, currency, frequency, effectiveFrom, notes } });
          toast.success("Compensation revision added");
          onDone();
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
      <Field label="Type" htmlFor="comp-type">
        <Select id="comp-type" value={type} onChange={(e) => setType(e.target.value)}>
          {COMPENSATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMPENSATION_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount" htmlFor="comp-amount" error={errors.amount} required>
        <Input id="comp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 45,000" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Currency" htmlFor="comp-currency" error={errors.currency}>
          <Input id="comp-currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Per" htmlFor="comp-frequency">
          <Select id="comp-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {PAY_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {PAY_FREQUENCY_LABELS[f].replace("per ", "")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Effective from" htmlFor="comp-effective" error={errors.effectiveFrom} required>
        <Input id="comp-effective" type="date" value={effectiveFrom} onChange={(e) => setEffective(e.target.value)} required />
      </Field>
      <Field label="Notes (optional)" htmlFor="comp-notes" error={errors.notes} className="sm:col-span-2">
        <Textarea id="comp-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} className="min-h-10" placeholder="e.g. Annual appraisal 2026, CTC breakdown reference" />
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Save revision
        </Button>
      </div>
    </form>
  );
}

/**
 * Salary / stipend / fee details (restricted). Nothing is fetched until the user asks to see
 * it, and each view is recorded in the activity log; values are kept only in memory.
 */
export function CompensationPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [data, setData] = useState<{ currentId: string | null; rows: CompensationRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CompensationRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<{ currentId: string | null; rows: CompensationRow[] }>(`/api/employees/${employeeId}/compensation`));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load compensation");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  const current = data?.rows.find((r) => r.id === data.currentId) ?? null;

  return (
    <Card>
      <ConfirmDialog
        open={removing !== null}
        busy={busy}
        options={{ title: "Delete this compensation entry?", description: "Use this only to correct a mistake — revisions are the pay history. The removal is recorded in the activity log.", confirmLabel: "Delete", tone: "danger" }}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          try {
            await api(`/api/employees/${employeeId}/compensation/${removing.id}`, { method: "DELETE" });
            toast.success("Entry deleted");
            setRemoving(null);
            await load();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Could not delete the entry");
          } finally {
            setBusy(false);
          }
        }}
      />
      <CardHeader
        eyebrow="Restricted"
        title="Salary & compensation"
        description="Visible only to people granted compensation access. Never exported or shown publicly; every view is logged."
        actions={
          data ? (
            <>
              {canManage && !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden /> Add revision
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setData(null)}>
                <EyeOff className="size-4" aria-hidden /> Hide
              </Button>
            </>
          ) : undefined
        }
      />
      {!data ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-navy-100 text-navy-700">
            <LockKeyhole className="size-5" aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-ink-muted">Compensation details are hidden. Showing them is recorded in the activity log.</p>
          <Button onClick={load} loading={loading} data-testid="show-compensation">
            Show compensation
          </Button>
        </div>
      ) : (
        <>
          {adding && (
            <AddRevision
              employeeId={employeeId}
              onDone={() => {
                setAdding(false);
                void load();
              }}
            />
          )}
          {current && (
            <div className="flex flex-wrap items-center gap-4 border-b border-border bg-gradient-to-r from-success-50 to-teal-50 px-5 py-4">
              <span className="grid size-11 place-items-center rounded-xl bg-white text-success-700 shadow-sm">
                <IndianRupee className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold tracking-wide text-success-700 uppercase">Current {COMPENSATION_TYPE_LABELS[current.type].toLowerCase()}</p>
                <p className="text-2xl font-bold text-ink tabular-nums" data-testid="current-compensation">
                  {money(current.amount, current.currency)} <span className="text-sm font-medium text-ink-muted">{PAY_FREQUENCY_LABELS[current.frequency]}</span>
                </p>
                <p className="text-xs text-ink-muted">Effective {formatDate(current.effectiveFrom)}</p>
              </div>
            </div>
          )}
          {data.rows.length === 0 ? (
            <EmptyState icon={<IndianRupee className="size-5" />} title="No compensation recorded" description={canManage ? "Add the current salary, stipend or fee." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-page/60 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-2.5">Effective from</th>
                    <th scope="col" className="px-5 py-2.5">Type</th>
                    <th scope="col" className="px-5 py-2.5 text-right">Amount</th>
                    <th scope="col" className="px-5 py-2.5">Notes</th>
                    {canManage && <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        {formatDate(r.effectiveFrom)}
                        {r.id === data.currentId && (
                          <Badge tone="success" className="ml-2">
                            Current
                          </Badge>
                        )}
                        {r.effectiveFrom > localToday() && (
                          <Badge tone="info" className="ml-2">
                            Upcoming
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-2.5">{COMPENSATION_TYPE_LABELS[r.type]}</td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {money(r.amount, r.currency)} <span className="text-xs text-ink-subtle">{PAY_FREQUENCY_LABELS[r.frequency]}</span>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-ink-muted">
                        {r.notes ?? "—"}
                        {r.createdBy && <span className="block text-ink-subtle">by {r.createdBy}</span>}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2.5">
                          <button type="button" onClick={() => setRemoving(r)} className="grid size-7 place-items-center rounded-md text-ink-subtle hover:bg-danger-50 hover:text-danger-700" aria-label="Delete entry">
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
