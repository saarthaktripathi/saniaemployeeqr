import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Search } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { listEmployeeAccounts } from "@/server/services/accounts";
import { ROLE_LABELS, type Role } from "@/server/authorization/permissions";
import { AccountActions } from "@/components/accounts/account-actions";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager, withQuery } from "@/components/ui/pager";
import { cn, formatDateTime } from "@/lib/cn";

export const metadata: Metadata = { title: "Employee Access" };

const TABS = [
  { key: "", label: "All" },
  { key: "none", label: "No login" },
  { key: "invited", label: "Invited" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Disabled" },
] as const;

export default async function EmployeeAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("account:manage");
  const sp = await searchParams;
  const data = await listEmployeeAccounts(db, actor, sp, ctx);
  const q = sp.q?.slice(0, 100) ?? "";
  const state = TABS.some((t) => t.key === sp.state) ? (sp.state ?? "") : "";
  const counts: Record<string, number> = { ...data.counts, "": data.counts.none + data.counts.invited + data.counts.active + data.counts.disabled };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Workforce access"
        title="Employee Access"
        description="Give employees a login to their own workspace (attendance, tasks, leave). Each login is tied to the employee's existing record: invite, reset passwords and deactivate here."
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <nav aria-label="Login state" className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <Link
                key={t.key || "all"}
                href={withQuery("/accounts", { state: t.key, q })}
                aria-current={state === t.key ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  state === t.key ? "bg-primary-600 text-white shadow-sm" : "text-ink-muted hover:bg-navy-100 hover:text-ink",
                )}
              >
                {t.label} <span className={cn("ml-1 text-xs", state === t.key ? "text-white/80" : "text-ink-subtle")}>{counts[t.key] ?? 0}</span>
              </Link>
            ))}
          </nav>
          <form action="/accounts" className="flex w-full items-center gap-2 sm:w-auto" role="search">
            {state && <input type="hidden" name="state" value={state} />}
            <label htmlFor="access-q" className="sr-only">
              Search employees
            </label>
            <Input id="access-q" name="q" defaultValue={q} placeholder="Name, employee ID or email" className="sm:w-64" />
            <Button type="submit" variant="secondary" aria-label="Search">
              <Search className="size-4" aria-hidden />
            </Button>
          </form>
        </div>

        {data.items.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-5" aria-hidden />} title="No employees here" description={q ? "Try a different search." : "Nothing matches this filter yet."} />
        ) : (
          <ul className="divide-y divide-border" data-testid="access-list">
            {data.items.map((r) => (
              <li key={r.employeeId} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between" data-testid="access-row" data-employee={r.employeeCode}>
                <div className="flex min-w-0 items-center gap-3">
                  <EmployeeAvatar id={r.employeeId} name={r.displayName} photoUpdatedAt={r.photoUpdatedAt} />
                  <div className="min-w-0">
                    <Link href={`/employees/${r.employeeId}`} className="block truncate font-medium text-ink hover:text-primary-600">
                      {r.displayName}
                    </Link>
                    <p className="truncate text-xs text-ink-subtle">
                      {r.employeeCode} · {r.jobTitle} · {r.department} · {r.company}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                  {r.state === "active" && (
                    <>
                      <Badge tone="success">Active</Badge>
                      <Badge tone={r.account?.role === "TEAM_MANAGER" ? "violet" : "info"} dot={false}>
                        {ROLE_LABELS[r.account!.role as Role]}
                      </Badge>
                      <span className="max-w-56 truncate text-xs text-ink-muted">{r.account?.email}</span>
                    </>
                  )}
                  {r.state === "disabled" && <Badge tone="danger">Disabled</Badge>}
                  {r.state === "invited" && (
                    <>
                      <Badge tone="warning">Invited</Badge>
                      <span className="text-xs text-ink-muted">until {formatDateTime(r.invite!.expiresAt)}</span>
                    </>
                  )}
                  {r.state === "none" && <Badge tone="neutral">No login</Badge>}
                  <AccountActions compact subject={{ employeeId: r.employeeId, displayName: r.displayName, workEmail: r.workEmail, account: r.account, invite: r.invite }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="employees" hrefFor={(p) => withQuery("/accounts", { state, q, page: p > 1 ? p : undefined })} />
      </Card>
    </div>
  );
}
