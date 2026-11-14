"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface CompanyView {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  employees: number;
  activeEmployees: number;
  totalRecords: number;
}

function CompanyEditor({ company, onDone }: { company?: CompanyView; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(company?.name ?? "");
  const [code, setCode] = useState(company?.code ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pre = company ? `co-${company.id}` : "co-new";

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          if (company) await api(`/api/companies/${company.id}`, { method: "PATCH", body: { name, code } });
          else await api("/api/companies", { body: { name, code } });
          toast.success(company ? "Company updated" : `${name} added`);
          onDone();
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) {
            const field = err.details?.field;
            setErrors({ ...Object.fromEntries(err.fields.map((f) => [f.path, f.message])), ...(typeof field === "string" ? { [field]: err.message } : {}) });
            toast.error(err.message);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Company name" htmlFor={`${pre}-name`} error={errors.name} required>
        <Input id={`${pre}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
      </Field>
      <Field label="Short code" htmlFor={`${pre}-code`} error={errors.code} hint="Optional, e.g. SJB">
        <Input id={`${pre}-code`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} />
      </Field>
      <div className="flex gap-2 sm:pb-[22px]">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {company ? "Save" : "Add company"}
        </Button>
      </div>
    </form>
  );
}

/** Owner screen: add, rename, deactivate and (when empty) delete group companies. */
export function CompaniesManager({ companies }: { companies: CompanyView[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CompanyView | null>(null);
  const [busy, setBusy] = useState(false);

  async function setActive(c: CompanyView, isActive: boolean) {
    try {
      await api(`/api/companies/${c.id}`, { method: "PATCH", body: { isActive } });
      toast.success(isActive ? `${c.name} is active again` : `${c.name} marked inactive — existing employees are kept`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the company");
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={removing !== null}
        busy={busy}
        options={{ title: `Delete ${removing?.name ?? "company"}?`, description: "The company has no employee records, so it can be removed. This cannot be undone.", confirmLabel: "Delete", tone: "danger" }}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          try {
            await api(`/api/companies/${removing.id}`, { method: "DELETE" });
            toast.success(`${removing.name} deleted`);
            setRemoving(null);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Could not delete the company");
          } finally {
            setBusy(false);
          }
        }}
      />
      <Card>
        <CardHeader
          eyebrow="Sania group"
          title="Companies"
          description={`${companies.length} ${companies.length === 1 ? "company" : "companies"}. Inactive companies keep their employees but can't receive new ones.`}
          actions={
            !adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> Add company
              </Button>
            )
          }
        />
        {adding && (
          <div className="border-b border-border bg-primary-50/40 p-5">
            <CompanyEditor onDone={() => setAdding(false)} />
          </div>
        )}
        {companies.length === 0 ? (
          <EmptyState icon={<Building2 className="size-5" />} title="No companies yet" description="Add the first company of the group." />
        ) : (
          <ul className="divide-y divide-border" data-testid="company-list">
            {companies.map((c) => (
              <li key={c.id} className="px-5 py-4">
                {editing === c.id ? (
                  <CompanyEditor company={c} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-50 to-violet-50 text-primary-700">
                        <Building2 className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                          {c.name}
                          {c.code && <span className="font-mono text-xs text-ink-subtle">{c.code}</span>}
                          {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
                        </p>
                        <p className="text-sm text-ink-muted">
                          <Link href={`/dashboard?company=${c.id}`} className="font-medium text-primary-600 hover:underline">
                            {c.employees.toLocaleString("en-IN")} {c.employees === 1 ? "employee" : "employees"}
                          </Link>{" "}
                          · {c.activeEmployees.toLocaleString("en-IN")} active
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c.id)}>
                        Rename
                      </Button>
                      <Button size="sm" variant={c.isActive ? "ghost" : "success"} onClick={() => setActive(c, !c.isActive)}>
                        {c.isActive ? "Mark inactive" : "Reactivate"}
                      </Button>
                      {c.totalRecords === 0 && (
                        <Button size="sm" variant="ghost" className="text-danger-700" onClick={() => setRemoving(c)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
