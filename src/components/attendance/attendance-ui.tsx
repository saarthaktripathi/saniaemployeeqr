import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatClock, formatDuration } from "@/lib/time";
import { DAY_STATUS_LABELS, type DayStatus } from "@/features/attendance/rules";
import { LOCATION_LABELS, type AttendanceLocation } from "@/features/attendance/schema";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import type { AttendanceRow } from "@/server/services/attendance-hr";

const STATUS_TONE: Record<DayStatus, "success" | "danger" | "warning" | "neutral" | "info" | "violet" | "teal" | "orange"> = {
  PRESENT: "success",
  HALF_DAY: "orange",
  SHORT: "warning",
  WORKING: "teal",
  ABSENT: "danger",
  NOT_STARTED: "neutral",
  ON_LEAVE: "violet",
  HOLIDAY: "info",
  WEEKLY_OFF: "neutral",
  UPCOMING: "neutral",
  NOT_EMPLOYED: "neutral",
};

/** Calendar cell colours per day status (month views). */
export const STATUS_CELL: Record<DayStatus, string> = {
  PRESENT: "bg-success-50 text-success-700 ring-success-700/20",
  HALF_DAY: "bg-orange-50 text-orange-700 ring-orange-700/20",
  SHORT: "bg-warning-50 text-warning-700 ring-warning-700/20",
  WORKING: "bg-teal-50 text-teal-700 ring-teal-700/25",
  ABSENT: "bg-danger-50 text-danger-700 ring-danger-700/20",
  NOT_STARTED: "bg-white text-ink-muted ring-border",
  ON_LEAVE: "bg-violet-50 text-violet-600 ring-violet-600/20",
  HOLIDAY: "bg-primary-50 text-primary-700 ring-primary-700/20",
  WEEKLY_OFF: "bg-navy-100/60 text-ink-subtle ring-border",
  UPCOMING: "bg-white text-ink-subtle ring-border",
  NOT_EMPLOYED: "bg-white text-ink-subtle/60 ring-border",
};

export function DayStatusBadge({ status }: { status: DayStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{DAY_STATUS_LABELS[status]}</Badge>;
}

export function Kpi({ label, value, hint, tone, icon, href, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone: string; icon: ReactNode; href?: string; testId?: string }) {
  const body = (
    <Card className="flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-[0_8px_28px_rgb(30_41_90/0.10)]" data-testid={testId}>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink-muted">{label}</span>
        <span className="block text-2xl font-bold text-ink tabular-nums" data-kpi-value>
          {value}
        </span>
        {hint && <span className="block text-xs text-ink-subtle">{hint}</span>}
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-card)]">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Attendance rows (photo, name, ID, department, designation, punch in/out, worked, location, status).
 * Server-rendered; `actions` renders per-row controls. Mobile shows cards instead of a table.
 */
export function AttendanceTable({ rows, timezone, actions, emptyTitle = "Nobody here", date, showDate, linkBase = "/attendance/employees/" }: { rows: (AttendanceRow & { date?: string })[]; timezone: string; actions?: (r: AttendanceRow) => ReactNode; emptyTitle?: string; date?: string; showDate?: boolean; linkBase?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description="Try another tab, date or filter." />;
  const link = (r: AttendanceRow & { date?: string }) => `${linkBase}${r.employeeId}${(r.date ?? date) ? `?month=${(r.date ?? date)!.slice(0, 7)}` : ""}`;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm" data-testid="attendance-table">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {showDate && <th className="px-4 py-3">Date</th>}
              <th className="px-4 py-3">Employee</th>
              <th className="px-3 py-3">Department</th>
              <th className="px-3 py-3">In</th>
              <th className="px-3 py-3">Out</th>
              <th className="px-3 py-3">Worked</th>
              <th className="px-3 py-3">Location</th>
              <th className="px-3 py-3">Status</th>
              {actions && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={`${r.employeeId}-${r.date ?? ""}`} className="hover:bg-navy-100/30" data-testid="attendance-row" data-employee={r.employeeCode}>
                {showDate && <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{r.date}</td>}
                <td className="px-4 py-3">
                  <Link href={link(r)} className="flex min-w-0 items-center gap-3">
                    <EmployeeAvatar id={r.employeeId} name={r.name} photoUpdatedAt={r.photoUpdatedAt} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink hover:text-primary-600">{r.name}</span>
                      <span className="block truncate text-xs text-ink-subtle">
                        {r.employeeCode} · {r.designation}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3 text-ink-muted">{r.department}</td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {formatClock(r.firstIn, timezone)}
                  {r.late && <span className="ml-1.5 text-xs font-semibold text-warning-700">+{r.lateMinutes}m</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {r.open ? <span className="text-teal-700">—</span> : formatClock(r.lastOut, timezone)}
                  {r.earlyLeave && <span className="ml-1.5 text-xs font-semibold text-orange-700">−{r.earlyMinutes}m</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">{r.workedSeconds ? formatDuration(r.workedSeconds) : "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-muted">{r.location ? LOCATION_LABELS[r.location as AttendanceLocation] : "—"}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    <DayStatusBadge status={r.status} />
                    {r.incomplete && <Badge tone="danger">Missed punch-out</Badge>}
                  </div>
                </td>
                {actions && <td className="px-4 py-3 text-right">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={`${r.employeeId}-${r.date ?? ""}-m`} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Link href={link(r)} className="flex min-w-0 items-center gap-3">
                <EmployeeAvatar id={r.employeeId} name={r.name} photoUpdatedAt={r.photoUpdatedAt} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{r.name}</span>
                  <span className="block truncate text-xs text-ink-subtle">
                    {showDate && r.date ? `${r.date} · ` : ""}
                    {r.employeeCode} · {r.department}
                  </span>
                </span>
              </Link>
              <DayStatusBadge status={r.status} />
            </div>
            <p className="text-xs text-ink-muted">
              In {formatClock(r.firstIn, timezone)} · Out {r.open ? "—" : formatClock(r.lastOut, timezone)} · {formatDuration(r.workedSeconds)}
              {r.location ? ` · ${LOCATION_LABELS[r.location as AttendanceLocation]}` : ""}
            </p>
            {actions && <div className="flex justify-end">{actions(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Month grid of day statuses (Monday-first). `hrefFor` makes days clickable. */
export function MonthGrid({ days, today, hrefFor, extra }: { days: { date: string; status: DayStatus; workedSeconds: number; late: boolean }[]; today: string; hrefFor?: (date: string) => string; extra?: (date: string) => ReactNode }) {
  if (days.length === 0) return null;
  const first = new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay();
  const lead = (first + 6) % 7;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" data-testid="month-grid">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const content = (
            <>
              <span className="flex items-center justify-between">
                <span className="font-semibold">{Number(d.date.slice(8))}</span>
                {d.late && <span className="size-1.5 rounded-full bg-warning-700" title="Late" aria-label="Late" />}
              </span>
              <span className="mt-0.5 hidden truncate text-[10px] sm:block">{DAY_STATUS_LABELS[d.status]}</span>
              {d.workedSeconds > 0 && <span className="hidden text-[10px] tabular-nums opacity-80 sm:block">{formatDuration(d.workedSeconds)}</span>}
              {extra?.(d.date)}
            </>
          );
          const cls = cn("min-h-14 rounded-lg p-1.5 text-left text-xs ring-1 ring-inset sm:min-h-20", STATUS_CELL[d.status], d.date === today && "outline-2 outline-primary-500");
          return hrefFor ? (
            <Link key={d.date} href={hrefFor(d.date)} className={cn(cls, "hover:brightness-95")} aria-label={`${d.date}: ${DAY_STATUS_LABELS[d.status]}`}>
              {content}
            </Link>
          ) : (
            <div key={d.date} className={cls} aria-label={`${d.date}: ${DAY_STATUS_LABELS[d.status]}`}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
