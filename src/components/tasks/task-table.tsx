import Link from "next/link";
import { AlertTriangle, ClipboardCheck, ListChecks, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLongDate } from "@/lib/time";
import { PRIORITY_LABELS, PRIORITY_TONES, STATUS_LABELS, STATUS_TONES, TASK_PRIORITIES, TASK_VIEWS, type TaskStatus, type TaskView } from "@/features/tasks/schema";
import type { listTasks } from "@/server/services/tasks";
import { Kpi } from "@/components/attendance/attendance-ui";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Pager, withQuery } from "@/components/ui/pager";

const VIEW_LABELS: Record<TaskView, string> = { all: "All", pending: "Pending", in_progress: "In progress", submitted: "Awaiting review", completed: "Completed", overdue: "Overdue" };

/** Task management list (HR and team managers): KPIs, view tabs, filters and paginated tasks. */
export function TaskTable({ data, basePath, detailBase, params }: { data: Awaited<ReturnType<typeof listTasks>>; basePath: string; detailBase: string; params: Record<string, string | undefined> }) {
  const view = (TASK_VIEWS as readonly string[]).includes(params.view ?? "") ? params.view! : "all";
  const keep = { q: params.q, priority: params.priority, mine: params.mine };
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Open assignments" value={data.kpis.open} tone="bg-primary-50 text-primary-700" icon={<ListChecks className="size-5" aria-hidden />} href={withQuery(basePath, { view: "in_progress" })} />
        <Kpi label="Awaiting your review" value={data.kpis.submitted} tone="bg-warning-50 text-warning-700" icon={<ClipboardCheck className="size-5" aria-hidden />} href={withQuery(basePath, { view: "submitted" })} testId="kpi-submitted" />
        <Kpi label="Overdue" value={data.kpis.overdue} tone="bg-danger-50 text-danger-700" icon={<AlertTriangle className="size-5" aria-hidden />} href={withQuery(basePath, { view: "overdue" })} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <nav aria-label="Task views" className="flex flex-wrap gap-1">
            {TASK_VIEWS.map((v) => (
              <Link
                key={v}
                href={withQuery(basePath, { ...keep, view: v === "all" ? undefined : v })}
                aria-current={view === v ? "page" : undefined}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", view === v ? "bg-primary-600 text-white shadow-sm" : "text-ink-muted hover:bg-navy-100 hover:text-ink")}
              >
                {VIEW_LABELS[v]}
              </Link>
            ))}
          </nav>
          <form action={basePath} className="flex flex-wrap items-center gap-2" role="search">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            <label htmlFor="task-q" className="sr-only">
              Search tasks
            </label>
            <Input id="task-q" name="q" defaultValue={params.q ?? ""} placeholder="Title or TSK number" className="sm:w-48" />
            <label htmlFor="task-priority-filter" className="sr-only">
              Priority
            </label>
            <Select id="task-priority-filter" name="priority" defaultValue={params.priority ?? ""} className="sm:w-36">
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-ink-muted">
              <input type="checkbox" name="mine" value="1" defaultChecked={params.mine === "1"} className="accent-primary-600" /> Created by me
            </label>
            <Button type="submit" variant="secondary" aria-label="Apply filters">
              <Search className="size-4" aria-hidden />
            </Button>
          </form>
        </div>
        {data.items.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-5" aria-hidden />} title="No tasks match" description="Create a task or change the filters." />
        ) : (
          <ul className="divide-y divide-border" data-testid="task-admin-list">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link href={`${detailBase}${t.id}`} className="flex flex-col gap-3 px-4 py-3 hover:bg-navy-100/30 lg:flex-row lg:items-center lg:justify-between" data-testid="task-admin-row">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <span className="truncate">{t.title}</span>
                      {t.cancelled && <Badge tone="neutral">Cancelled</Badge>}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {t.code} · {t.department ? `Department: ${t.department}` : t.assignees.map((a) => a.name).join(", ")}
                      {t.counts && Object.values(t.counts).reduce((s, n) => s + n, 0) > t.assignees.length ? ` +${Object.values(t.counts).reduce((s, n) => s + n, 0) - t.assignees.length} more` : ""}
                      {t.createdBy ? ` · by ${t.createdBy}` : ""}
                      {t.dueDate ? ` · due ${formatLongDate(t.dueDate)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="w-24">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-navy-100">
                        <span className="block h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-600" style={{ width: `${t.progress}%` }} />
                      </span>
                      <span className="text-xs text-ink-subtle tabular-nums">{t.progress}% avg</span>
                    </span>
                    <Badge tone={PRIORITY_TONES[t.priority]} dot={false}>
                      {PRIORITY_LABELS[t.priority]}
                    </Badge>
                    {(Object.entries(t.counts) as [TaskStatus, number][])
                      .filter(([s, n]) => n > 0 && s !== "CANCELLED")
                      .map(([s, n]) => (
                        <Badge key={s} tone={STATUS_TONES[s]}>
                          {n} {STATUS_LABELS[s].toLowerCase()}
                        </Badge>
                      ))}
                    {t.overdue > 0 && <Badge tone="danger">{t.overdue} overdue</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="tasks" hrefFor={(p) => withQuery(basePath, { ...keep, view: view === "all" ? undefined : view, page: p > 1 ? p : undefined })} />
      </Card>
    </div>
  );
}
