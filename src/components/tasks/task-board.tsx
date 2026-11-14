"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";
import { eachDate, formatLongDate, monthBounds } from "@/lib/time";
import { PRIORITY_LABELS, PRIORITY_TONES, STATUS_LABELS, STATUS_TONES, TASK_VIEWS, type TaskStatus, type TaskView } from "@/features/tasks/schema";
import { matchesView } from "@/features/tasks/rules";
import type { MyTaskItem } from "@/server/services/tasks";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";

const VIEW_LABELS: Record<TaskView, string> = { all: "All tasks", pending: "Pending", in_progress: "In progress", submitted: "Submitted", completed: "Completed", overdue: "Overdue" };
const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: "To do", statuses: ["ASSIGNED", "ACCEPTED"] },
  { title: "In progress", statuses: ["IN_PROGRESS", "REJECTED"] },
  { title: "In review", statuses: ["SUBMITTED"] },
  { title: "Done", statuses: ["APPROVED"] },
];
type Layout = "list" | "kanban" | "calendar";

function DueLabel({ t }: { t: MyTaskItem }) {
  if (!t.dueDate) return <span className="text-ink-subtle">No due date</span>;
  return <span className={cn(t.overdue ? "font-semibold text-danger-700" : t.dueSoon ? "font-semibold text-warning-700" : "text-ink-muted")}>{t.overdue ? "Overdue · " : t.dueSoon ? "Due soon · " : "Due "}{formatLongDate(t.dueDate)}</span>;
}

function TaskCard({ t, href }: { t: MyTaskItem; href: string }) {
  return (
    <Link href={href} className="block rounded-xl border border-border bg-white p-3 shadow-xs transition-shadow hover:shadow-md" data-testid="task-card" data-status={t.status}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium text-ink">{t.title}</p>
        <Badge tone={PRIORITY_TONES[t.priority]} dot={false}>
          {PRIORITY_LABELS[t.priority]}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-ink-subtle">
        {t.code}
        {t.assignedBy ? ` · from ${t.assignedBy}` : ""}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-100" aria-label={`Progress ${t.progress}%`}>
        <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-600" style={{ width: `${t.progress}%` }} />
      </div>
      <p className="mt-2 text-xs">
        <DueLabel t={t} />
      </p>
    </Link>
  );
}

/** Personal task board: views, and list / kanban / calendar layouts over the same data. */
export function TaskBoard({ items, today, initialView, hrefBase }: { items: MyTaskItem[]; today: string; initialView: TaskView; hrefBase: string }) {
  const [view, setView] = useState<TaskView>(initialView);
  const [layout, setLayout] = useState<Layout>("list");
  const [month, setMonth] = useState(today.slice(0, 7));
  const counts = useMemo(() => Object.fromEntries(TASK_VIEWS.map((v) => [v, items.filter((i) => matchesView(v, i.status, i.overdue) && (v !== "all" || i.status !== "CANCELLED")).length])) as Record<TaskView, number>, [items]);
  const shown = items.filter((i) => matchesView(view, i.status, i.overdue) && (view !== "all" || i.status !== "CANCELLED"));
  const link = (t: MyTaskItem) => `${hrefBase}${t.taskId}`;

  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Task views" className="flex flex-wrap gap-1 rounded-xl bg-white/80 p-1 shadow-sm">
          {TASK_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", view === v ? "bg-primary-600 text-white shadow-sm" : "text-ink-muted hover:bg-navy-100 hover:text-ink", v === "overdue" && counts.overdue > 0 && view !== v && "text-danger-700")}
            >
              {VIEW_LABELS[v]} <span className={cn("ml-0.5 text-xs", view === v ? "text-white/80" : "text-ink-subtle")}>{counts[v]}</span>
            </button>
          ))}
        </nav>
        <div className="flex gap-1 rounded-xl bg-white/80 p-1 shadow-sm" role="group" aria-label="Layout">
          {(
            [
              ["list", List, "List"],
              ["kanban", Columns3, "Kanban"],
              ["calendar", CalendarDays, "Calendar"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} type="button" onClick={() => setLayout(k)} aria-pressed={layout === k} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", layout === k ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-100")}>
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && layout !== "calendar" ? (
        <Card>
          <EmptyState icon={<ListChecks className="size-5" aria-hidden />} title="No tasks here" description={view === "overdue" ? "Nothing overdue. Nice work!" : "New tasks from HR or your manager will appear here."} />
        </Card>
      ) : layout === "list" ? (
        <Card>
          <ul className="divide-y divide-border" data-testid="task-list">
            {shown.map((t) => (
              <li key={t.assignmentId}>
                <Link href={link(t)} className="flex flex-col gap-2 px-5 py-3 hover:bg-navy-100/30 sm:flex-row sm:items-center sm:justify-between" data-testid="task-row">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{t.title}</span>
                    <span className="block text-xs text-ink-subtle">
                      {t.code}
                      {t.assignedBy ? ` · from ${t.assignedBy}` : ""} · <DueLabel t={t} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-muted tabular-nums">{t.progress}%</span>
                    <Badge tone={PRIORITY_TONES[t.priority]} dot={false}>
                      {PRIORITY_LABELS[t.priority]}
                    </Badge>
                    <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : layout === "kanban" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="kanban">
          {COLUMNS.map((c) => {
            const col = shown.filter((t) => c.statuses.includes(t.status));
            return (
              <section key={c.title} className="rounded-2xl bg-navy-100/50 p-3" aria-label={c.title}>
                <h3 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-ink">
                  {c.title} <span className="rounded-full bg-white px-2 text-xs text-ink-muted">{col.length}</span>
                </h3>
                <div className="space-y-2">
                  {col.map((t) => (
                    <TaskCard key={t.assignmentId} t={t} href={link(t)} />
                  ))}
                  {col.length === 0 && <p className="px-1 py-4 text-center text-xs text-ink-subtle">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <p className="font-semibold text-ink">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
            <button type="button" onClick={() => shift(1)} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <TaskCalendar month={month} today={today} items={shown} hrefFor={link} />
        </Card>
      )}
    </div>
  );
}

function TaskCalendar({ month, today, items, hrefFor }: { month: string; today: string; items: MyTaskItem[]; hrefFor: (t: MyTaskItem) => string }) {
  const { start, end } = monthBounds(month);
  const days = eachDate(start, end);
  const lead = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const byDue = new Map<string, MyTaskItem[]>();
  for (const t of items) if (t.dueDate) byDue.set(t.dueDate, [...(byDue.get(t.dueDate) ?? []), t]);
  const undated = items.filter((t) => !t.dueDate && t.status !== "APPROVED" && t.status !== "CANCELLED");
  return (
    <div data-testid="task-calendar">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-subtle uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={i} />
        ))}
        {days.map((d) => (
          <div key={d} className={cn("min-h-20 rounded-lg border border-border bg-white p-1.5 text-xs", d === today && "border-primary-500 ring-1 ring-primary-500", d < today && "bg-page")}>
            <p className="font-semibold text-ink-muted">{Number(d.slice(8))}</p>
            <div className="mt-1 space-y-1">
              {(byDue.get(d) ?? []).slice(0, 3).map((t) => (
                <Link key={t.assignmentId} href={hrefFor(t)} className={cn("block truncate rounded px-1 py-0.5 text-[11px] font-medium", t.overdue ? "bg-danger-50 text-danger-700" : t.status === "APPROVED" ? "bg-success-50 text-success-700" : "bg-primary-50 text-primary-700")} title={t.title}>
                  {t.title}
                </Link>
              ))}
              {(byDue.get(d)?.length ?? 0) > 3 && <p className="text-[10px] text-ink-subtle">+{byDue.get(d)!.length - 3} more</p>}
            </div>
          </div>
        ))}
      </div>
      {undated.length > 0 && <p className="mt-3 text-xs text-ink-subtle">{undated.length} open task(s) have no due date; see the list view.</p>}
    </div>
  );
}
