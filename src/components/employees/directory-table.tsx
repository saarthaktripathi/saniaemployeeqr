"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, CalendarDays, EllipsisVertical, IdCard, Pencil, QrCode, Trash2, UserPlus, Users } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { CredentialBadge, EmploymentBadge, IdValidityBadge } from "./status-badges";
import { EmployeeAvatar } from "./employee-avatar";
import { useStatusAction } from "./use-status-action";
import { useDeleteAction } from "./use-delete-action";
import { DirectoryBusy } from "./directory-context";
import { DepartmentIcon, departmentAccent } from "./department-style";
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

const pill = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors";

/** Overflow menu for the less frequent row actions. */
function RowMenu({ r, perms, request, del }: { r: DirectoryRow; perms: DirectoryPerms; request: RequestStatus; del: RequestDelete }) {
  // Fixed position (from the button's rect) so the menu is never clipped by the table's scroll box.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;
  const ref = useRef<HTMLDivElement>(null);
  const anchorTop = useRef(0);
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    // Keep the menu attached to its button while the page or table scrolls.
    const follow = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return close();
      setPos((p) => (p ? { top: p.top + (rect.top - anchorTop.current), left: Math.max(8, rect.right - 160) } : p));
      anchorTop.current = rect.top;
    };
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const want = typeof next === "function" ? next(open) : next;
    if (!want) return setPos(null);
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    anchorTop.current = rect.top;
    const height = 44 * 3 + 8;
    const below = rect.bottom + 4 + height < window.innerHeight;
    setPos({ top: below ? rect.bottom + 4 : rect.top - height - 4, left: Math.max(8, rect.right - 160) });
  };
  const items = [
    perms.credentialRead && r.credential === "VALID" && { key: "card", label: "ID card", icon: IdCard, href: `/employees/${r.id}/id-card` },
    perms.archive && !r.archived && { key: "archive", label: "Archive", icon: Archive, onClick: () => request("archive", [r.id], r.displayName) },
    perms.archive && r.archived && { key: "unarchive", label: "Unarchive", icon: ArchiveRestore, onClick: () => request("unarchive", [r.id], r.displayName) },
    perms.delete && { key: "delete", label: "Delete", icon: Trash2, danger: true, onClick: () => del([r.id], r.displayName) },
  ].filter(Boolean) as { key: string; label: string; icon: typeof IdCard; href?: string; danger?: boolean; onClick?: () => void }[];
  if (!items.length) return <span className="w-8" />;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`More actions for ${r.displayName}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-navy-100 hover:text-ink"
      >
        <EllipsisVertical className="size-4" aria-hidden />
      </button>
      <div
        role="menu"
        style={pos ?? undefined}
        className={cn(
          "fixed z-40 w-40 origin-top-right rounded-xl border border-border bg-white p-1 text-left shadow-[var(--shadow-lift)] transition-[opacity,transform] duration-150",
          open ? "scale-100 opacity-100" : "pointer-events-none invisible scale-95 opacity-0",
        )}
      >
        {items.map((it) => {
          const Icon = it.icon;
          const cls = cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm", it.danger ? "text-danger-700 hover:bg-danger-50" : "text-ink hover:bg-navy-100/70");
          return it.href ? (
            <Link key={it.key} href={it.href} role="menuitem" className={cls} onClick={() => setOpen(false)}>
              <Icon className="size-4" aria-hidden /> {it.label}
            </Link>
          ) : (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={cls}
              onClick={() => {
                setOpen(false);
                it.onClick?.();
              }}
              aria-label={it.key === "delete" ? `Delete ${r.displayName}` : undefined}
            >
              <Icon className="size-4" aria-hidden /> {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RowActions({ r, perms, request, del }: { r: DirectoryRow; perms: DirectoryPerms; request: RequestStatus; del: RequestDelete }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {perms.update && !r.archived && (
        <Link href={`/employees/${r.id}/edit`} className={cn(pill, "border border-border-strong bg-white text-ink hover:bg-navy-100/50")} aria-label={`Edit ${r.displayName}`}>
          <Pencil className="size-3.5" aria-hidden /> <span className="hidden xl:inline">Edit</span>
        </Link>
      )}
      {perms.credentialRead && (
        <Link href={`/employees/${r.id}#credential`} className={cn(pill, "border border-border-strong bg-white text-ink hover:bg-navy-100/50")} aria-label={`Preview QR for ${r.displayName}`}>
          <QrCode className="size-3.5" aria-hidden /> <span className="hidden xl:inline">Preview QR</span>
        </Link>
      )}
      {!r.archived && r.employmentStatus === "ACTIVE" && perms.deactivate && (
        <button type="button" className={cn(pill, "min-w-[96px] border border-[#ffd3d6] bg-[#fff1f2] text-[#e03140] hover:bg-[#ffe3e6]")} onClick={() => request("deactivate", [r.id], r.displayName)}>
          Deactivate
        </button>
      )}
      {!r.archived && r.employmentStatus === "INACTIVE" && perms.reactivate && (
        <button type="button" className={cn(pill, "min-w-[96px] border border-[#bfeccf] bg-[#ecfbf1] text-[#12a150] hover:bg-[#dcf7e6]")} onClick={() => request("reactivate", [r.id], r.displayName)}>
          Reactivate
        </button>
      )}
      <RowMenu r={r} perms={perms} request={request} del={del} />
    </div>
  );
}

function NameCell({ r }: { r: DirectoryRow }) {
  return (
    <Link href={`/employees/${r.id}`} className="group flex min-w-0 items-center gap-3">
      <EmployeeAvatar id={r.id} name={r.displayName} photoUpdatedAt={r.photoUpdatedAt} size="md" className="size-11 shadow-sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink transition-colors group-hover:text-primary-600">{r.displayName}</span>
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
    <tr className={cn("transition-colors hover:bg-[#f7f6ff]", checked && "bg-primary-50/70")} data-testid="employee-row">
      {bulkEnabled && (
        <td className="relative px-4 py-3">
          <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" style={{ background: departmentAccent(r.department) }} aria-hidden />
          <input type="checkbox" aria-label={`Select ${r.displayName}`} className="size-4 accent-primary-600" checked={checked} onChange={() => onToggle(r.id)} />
        </td>
      )}
      <td className="max-w-64 px-4 py-3">
        <NameCell r={r} />
      </td>
      <td className="px-4 py-3 text-[13px] font-semibold whitespace-nowrap text-ink">{r.employeeCode}</td>
      <td className="px-4 py-3 text-ink-muted">
        <span className="flex items-center gap-2">
          <DepartmentIcon department={r.department} className="size-[18px] shrink-0" />
          {r.department}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2 text-ink-muted">
          <CalendarDays className="size-4 text-ink-subtle" aria-hidden />
          {formatDate(r.idExpiresAt)}
        </div>
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

export function DirectoryTable({ rows, perms, total, canCreate, footer }: { rows: DirectoryRow[]; perms: DirectoryPerms; total: number; canCreate: boolean; footer?: ReactNode }) {
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
      <Card className="overflow-hidden rounded-2xl border-white shadow-[0_4px_24px_rgb(30_41_90/0.07)]">
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
            <thead className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
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
        {footer}
      </Card>
    </DirectoryBusy>
  );
}
