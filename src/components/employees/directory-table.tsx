"use client";

import Link from "next/link";
import { memo, useCallback, useState } from "react";
import { IdCard, Pencil, QrCode, Trash2, UserPlus, Users } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { CredentialBadge, EmploymentBadge, IdValidityBadge } from "./status-badges";
import { EmployeeAvatar } from "./employee-avatar";
import { useStatusAction } from "./use-status-action";
import { useDeleteAction } from "./use-delete-action";
import { DirectoryBusy } from "./directory-context";
import { cn, formatDate } from "@/lib/cn";
import type { CredentialState, IdValidity } from "@/features/employees/rules";
import type { StatusAction } from "@/features/employees/schema";

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
  /** null when the employee has no photo */
  photoUpdatedAt: string | null;
}

export interface DirectoryPerms {
  update: boolean;
  deactivate: boolean;
  reactivate: boolean;
  archive: boolean;
  delete: boolean;
  credentialRead: boolean;
}

type RequestStatus = (action: StatusAction, ids: string[], label: string) => void;
type RequestDelete = (ids: string[], label: string) => void;

function RowActions({ r, perms, request, del }: { r: DirectoryRow; perms: DirectoryPerms; request: RequestStatus; del: RequestDelete }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
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
      {perms.credentialRead && r.credential === "VALID" && (
        <ButtonLink href={`/employees/${r.id}/id-card`} size="sm" variant="secondary" aria-label={`ID card for ${r.displayName}`}>
          <IdCard className="size-3.5" aria-hidden />
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
        <Button size="sm" variant="ghost" onClick={() => del([r.id], r.displayName)} aria-label={`Delete ${r.displayName}`}>
          <Trash2 className="size-3.5 text-danger-700" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function NameCell({ r }: { r: DirectoryRow }) {
  return (
    <Link href={`/employees/${r.id}`} className="group flex min-w-0 items-center gap-3">
      <EmployeeAvatar id={r.id} name={r.displayName} photoUpdatedAt={r.photoUpdatedAt} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink transition-colors group-hover:text-primary-600">{r.displayName}</span>
        <span className="block truncate text-xs text-ink-subtle">{r.jobTitle}</span>
      </span>
    </Link>
  );
}

const TableRow = memo(function TableRow({
  r,
  perms,
  bulkEnabled,
  checked,
  onToggle,
  request,
  del,
}: {
  r: DirectoryRow;
  perms: DirectoryPerms;
  bulkEnabled: boolean;
  checked: boolean;
  onToggle: (id: string) => void;
  request: RequestStatus;
  del: RequestDelete;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-primary-50/40", checked && "bg-primary-50/70")} data-testid="employee-row">
      {bulkEnabled && (
        <td className="px-4 py-3">
          <input type="checkbox" aria-label={`Select ${r.displayName}`} className="size-4 accent-primary-600" checked={checked} onChange={() => onToggle(r.id)} />
        </td>
      )}
      <td className="max-w-64 px-4 py-3">
        <NameCell r={r} />
      </td>
      <td className="px-4 py-3 font-mono text-[13px] font-medium whitespace-nowrap text-ink">{r.employeeCode}</td>
      <td className="px-4 py-3 text-ink-muted">{r.department}</td>
      <td className="px-4 py-3 whitespace-nowrap">
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
        <RowActions r={r} perms={perms} request={request} del={del} />
      </td>
    </tr>
  );
});

export function DirectoryTable({ rows, perms, total, canCreate }: { rows: DirectoryRow[]; perms: DirectoryPerms; total: number; canCreate: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clear = useCallback(() => setSelected(new Set()), []);
  const { request, dialog } = useStatusAction(clear);
  const del = useDeleteAction({ onDone: clear });
  const bulkEnabled = perms.deactivate || perms.reactivate || perms.delete;
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;
  const activeSel = visibleSelected.filter((r) => r.employmentStatus === "ACTIVE" && !r.archived);
  const inactiveSel = visibleSelected.filter((r) => r.employmentStatus === "INACTIVE" && !r.archived);

  const toggle = useCallback(
    (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  if (rows.length === 0) {
    return (
      <DirectoryBusy>
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
      </DirectoryBusy>
    );
  }

  return (
    <DirectoryBusy>
      <Card className="overflow-hidden">
        {dialog}
        {del.dialog}
        {bulkEnabled && visibleSelected.length > 0 && (
          <div className="animate-fade flex flex-wrap items-center gap-2 border-b border-primary-100 bg-gradient-to-r from-primary-50 to-violet-50 px-4 py-2 text-sm" role="region" aria-label="Bulk actions">
            <span className="font-medium text-primary-700">{visibleSelected.length} selected</span>
            {perms.deactivate && (
              <Button size="sm" variant="danger" onClick={() => request("deactivate", activeSel.map((r) => r.id), `${activeSel.length} employees`)} disabled={!activeSel.length}>
                Deactivate
              </Button>
            )}
            {perms.reactivate && (
              <Button size="sm" variant="success" onClick={() => request("reactivate", inactiveSel.map((r) => r.id), `${inactiveSel.length} employees`)} disabled={!inactiveSel.length}>
                Reactivate
              </Button>
            )}
            {perms.delete && (
              <Button size="sm" variant="danger" onClick={() => del.request(visibleSelected.map((r) => r.id), visibleSelected.length === 1 ? visibleSelected[0].displayName : `${visibleSelected.length} employees`)}>
                <Trash2 className="size-3.5" aria-hidden /> Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear selection
            </Button>
          </div>
        )}

        {/* Tablet and desktop: table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Employee directory</caption>
            <thead className="bg-page/70 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              <tr>
                {bulkEnabled && (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input type="checkbox" aria-label="Select all on this page" className="size-4 accent-primary-600" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
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
                <TableRow key={r.id} r={r} perms={perms} bulkEnabled={bulkEnabled} checked={selected.has(r.id)} onToggle={toggle} request={request} del={del.request} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Phones: cards */}
        <ul className="divide-y divide-border md:hidden" aria-label="Employee directory">
          {rows.map((r) => (
            <li key={r.id} className={cn("space-y-3 p-4", selected.has(r.id) && "bg-primary-50/70")} data-testid="employee-card">
              <div className="flex items-start gap-3">
                {bulkEnabled && <input type="checkbox" aria-label={`Select ${r.displayName}`} className="mt-3 size-4 accent-primary-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                <div className="min-w-0 flex-1">
                  <NameCell r={r} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink-subtle">Employee ID</dt>
                  <dd className="font-mono font-medium text-ink">{r.employeeCode}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Department</dt>
                  <dd className="text-ink">{r.department}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Valid until</dt>
                  <dd className="text-ink">{formatDate(r.idExpiresAt)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-1">
                <EmploymentBadge status={r.employmentStatus} archived={r.archived} />
                <CredentialBadge state={r.credential} />
                {r.idValidity !== "VALID" && <IdValidityBadge validity={r.idValidity} />}
              </div>
              <RowActions r={r} perms={perms} request={request} del={del.request} />
            </li>
          ))}
        </ul>
      </Card>
    </DirectoryBusy>
  );
}
