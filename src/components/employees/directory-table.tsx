"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, QrCode, Trash2, UserPlus, Users } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { CredentialBadge, EmploymentBadge, IdValidityBadge } from "./status-badges";
import { useStatusAction } from "./use-status-action";
import { useDeleteAction } from "./use-delete-action";
import { cn, formatDate, initials } from "@/lib/cn";
import type { CredentialState, IdValidity } from "@/features/employees/rules";

export interface DirectoryRow {
  id: string;
  employeeCode: string;
  displayName: string;
  department: string;
  jobTitle: string;
  employmentStatus: "ACTIVE" | "INACTIVE";
  archived: boolean;
  idExpiresAt: string;
  idValidity: IdValidity;
  credential: CredentialState;
}

export interface DirectoryPerms {
  update: boolean;
  deactivate: boolean;
  reactivate: boolean;
  archive: boolean;
  delete: boolean;
  credentialRead: boolean;
}

export function DirectoryTable({ rows, perms, total, canCreate }: { rows: DirectoryRow[]; perms: DirectoryPerms; total: number; canCreate: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { request, dialog } = useStatusAction(() => setSelected(new Set()));
  const del = useDeleteAction({ onDone: () => setSelected(new Set()) });
  const bulkEnabled = perms.deactivate || perms.reactivate || perms.delete;
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Users className="size-5" />}
          title={total === 0 ? "No employees match" : "Nothing on this page"}
          description="Try a different search or filter, or add a new employee record."
          action={
            canCreate ? (
              <ButtonLink href="/employees/new" size="sm">
                <UserPlus className="size-4" aria-hidden /> Add Employee
              </ButtonLink>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {dialog}
      {del.dialog}
      {bulkEnabled && visibleSelected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-50 px-4 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium text-primary-700">{visibleSelected.length} selected</span>
          {perms.deactivate && (
            <Button size="sm" variant="danger" onClick={() => request("deactivate", visibleSelected.filter((r) => r.employmentStatus === "ACTIVE" && !r.archived).map((r) => r.id), `${visibleSelected.filter((r) => r.employmentStatus === "ACTIVE" && !r.archived).length} employees`)} disabled={!visibleSelected.some((r) => r.employmentStatus === "ACTIVE" && !r.archived)}>
              Deactivate
            </Button>
          )}
          {perms.reactivate && (
            <Button size="sm" variant="success" onClick={() => request("reactivate", visibleSelected.filter((r) => r.employmentStatus === "INACTIVE" && !r.archived).map((r) => r.id), `${visibleSelected.filter((r) => r.employmentStatus === "INACTIVE" && !r.archived).length} employees`)} disabled={!visibleSelected.some((r) => r.employmentStatus === "INACTIVE" && !r.archived)}>
              Reactivate
            </Button>
          )}
          {perms.delete && (
            <Button size="sm" variant="danger" onClick={() => del.request(visibleSelected.map((r) => r.id), visibleSelected.length === 1 ? visibleSelected[0].displayName : `${visibleSelected.length} employees`)}>
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Employee directory</caption>
          <thead className="bg-page/60 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            <tr>
              {bulkEnabled && (
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="size-4 accent-primary-600"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th scope="col" className="px-4 py-3">Employee</th>
              <th scope="col" className="px-4 py-3">Employee ID</th>
              <th scope="col" className="px-4 py-3">Department</th>
              <th scope="col" className="px-4 py-3">Valid until</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-page/50", selected.has(r.id) && "bg-primary-50/50")} data-testid="employee-row">
                {bulkEnabled && (
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${r.displayName}`} className="size-4 accent-primary-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/employees/${r.id}`} className="group flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800" aria-hidden>
                      {initials(r.displayName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink group-hover:text-primary-600 group-hover:underline">{r.displayName}</span>
                      <span className="block truncate text-xs text-ink-subtle">{r.jobTitle}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink">{r.employeeCode}</td>
                <td className="px-4 py-3 text-ink-muted">{r.department}</td>
                <td className="px-4 py-3">
                  <div className="text-ink">{formatDate(r.idExpiresAt)}</div>
                  {r.idValidity !== "VALID" && (
                    <div className="mt-1">
                      <IdValidityBadge validity={r.idValidity} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <EmploymentBadge status={r.employmentStatus} archived={r.archived} />
                    <CredentialBadge state={r.credential} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {perms.update && !r.archived && (
                      <ButtonLink href={`/employees/${r.id}/edit`} size="sm" variant="secondary" aria-label={`Edit ${r.displayName}`}>
                        <Pencil className="size-3.5" aria-hidden /> <span className="hidden 2xl:inline">Edit</span>
                      </ButtonLink>
                    )}
                    {perms.credentialRead && (
                      <ButtonLink href={`/employees/${r.id}#credential`} size="sm" variant="secondary" aria-label={`Preview QR for ${r.displayName}`}>
                        <QrCode className="size-3.5" aria-hidden /> <span className="hidden 2xl:inline">Preview QR</span>
                      </ButtonLink>
                    )}
                    {!r.archived && r.employmentStatus === "ACTIVE" && perms.deactivate && (
                      <Button size="sm" variant="danger" onClick={() => request("deactivate", [r.id], r.displayName)}>
                        Deactivate
                      </Button>
                    )}
                    {!r.archived && r.employmentStatus === "INACTIVE" && perms.reactivate && (
                      <Button size="sm" variant="success" onClick={() => request("reactivate", [r.id], r.displayName)}>
                        Reactivate
                      </Button>
                    )}
                    {r.archived && perms.archive && (
                      <Button size="sm" variant="secondary" onClick={() => request("unarchive", [r.id], r.displayName)}>
                        Unarchive
                      </Button>
                    )}
                    {perms.delete && (
                      <Button size="sm" variant="ghost" onClick={() => del.request([r.id], r.displayName)} aria-label={`Delete ${r.displayName}`}>
                        <Trash2 className="size-3.5 text-danger-700" aria-hidden />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
