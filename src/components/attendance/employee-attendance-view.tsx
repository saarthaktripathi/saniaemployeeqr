import Link from "next/link";
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, Clock, Plane } from "lucide-react";
import type { EmployeeAttendance } from "@/server/services/attendance-hr";
import { formatClock, formatDuration, formatLongDate } from "@/lib/time";
import { formatDateTime } from "@/lib/cn";
import { CORRECTION_LABELS, LOCATION_LABELS, type AttendanceLocation } from "@/features/attendance/schema";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { DayStatusBadge, Kpi, MonthGrid } from "@/components/attendance/attendance-ui";
import { CorrectionButton } from "@/components/attendance/correction-dialog";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const EVENT_LABELS: Record<string, string> = {
  PUNCH_IN: "Punched in",
  PUNCH_OUT: "Punched out",
  SESSION_ADDED: "Session added",
  SESSION_CORRECTED: "Session corrected",
  SESSION_VOIDED: "Session removed",
  SESSION_RESOLVED: "Missed punch-out resolved",
};

/** One employee's attendance month (HR and team managers): stats, calendar, sessions, audit trail, corrections. */
export function EmployeeAttendanceView({ a, base, showNav, canPolicy, profileLink }: { a: EmployeeAttendance; base: string; showNav: boolean; canPolicy: boolean; profileLink: boolean }) {
  const tz = a.timezone;
  const s = a.stats;
  const days = [...a.days].reverse().filter((d) => d.date <= a.today && d.status !== "NOT_EMPLOYED");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Attendance Management"
        title={a.employee.name}
        description={`${a.employee.employeeCode} · ${a.employee.designation} · ${a.employee.department} · ${a.employee.company}`}
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-white/80 p-1 shadow-sm">
            <Link href={`${base}?month=${shiftMonth(a.month, -1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="px-2 text-sm font-semibold text-ink">{monthLabel(a.month)}</span>
            <Link href={`${base}?month=${shiftMonth(a.month, 1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        }
      />
      {showNav && <AttendanceNav current="" canPolicy={canPolicy} />}
      <div className="mb-5 flex items-center gap-3">
        <EmployeeAvatar id={a.employee.id} name={a.employee.name} photoUpdatedAt={a.employee.photoUpdatedAt} size="md" />
        {profileLink && (
          <Link href={`/employees/${a.employee.id}`} className="text-sm font-medium text-primary-600 hover:underline">
            Open employee profile →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Present days" value={s.present + s.halfDays * 0.5} tone="bg-success-50 text-success-700" icon={<CalendarCheck2 className="size-5" aria-hidden />} hint={s.attendancePercent === null ? undefined : `${s.attendancePercent}% attendance`} />
        <Kpi label="Absent days" value={s.absent} tone="bg-danger-50 text-danger-700" icon={<CalendarX2 className="size-5" aria-hidden />} hint={`${s.lateDays} late arrival(s)`} />
        <Kpi label="Leave days" value={s.leaveDays} tone="bg-violet-50 text-violet-600" icon={<Plane className="size-5" aria-hidden />} />
        <Kpi label="Hours worked" value={formatDuration(s.workedSeconds)} tone="bg-primary-50 text-primary-700" icon={<Clock className="size-5" aria-hidden />} />
      </div>
      <Card className="mt-5 p-4 sm:p-5">
        <MonthGrid days={a.days} today={a.today} hrefFor={(d) => `#day-${d}`} />
      </Card>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader title="Days and sessions" description={a.canManage ? "Corrections you make apply immediately and are recorded with before/after values." : undefined} />
          <ul className="divide-y divide-border" data-testid="employee-days">
            {days.map((d) => {
              const sessions = a.sessions.filter((x) => x.workDate === d.date);
              return (
                <li key={d.date} id={`day-${d.date}`} className="flex scroll-mt-24 flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {formatLongDate(d.date)} <DayStatusBadge status={d.status} />
                      {d.late && <Badge tone="warning">Late {d.lateMinutes}m</Badge>}
                      {d.earlyLeave && <Badge tone="orange">Early {d.earlyMinutes}m</Badge>}
                      {d.incomplete && <Badge tone="danger">Missed punch-out</Badge>}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {sessions.length
                        ? sessions.map((x) => `${formatClock(x.punchInAt, tz)}–${x.punchOutAt ? formatClock(x.punchOutAt, tz) : "open"} ${LOCATION_LABELS[x.location as AttendanceLocation]}${x.status === "CORRECTED" ? " (corrected)" : x.status === "VOIDED" ? " (removed)" : ""}`).join(" · ")
                        : "No punches"}
                      {d.workedSeconds > 0 && <span className="ml-2 font-medium text-ink">{formatDuration(d.workedSeconds)}</span>}
                    </p>
                  </div>
                  {a.canManage && (
                    <CorrectionButton
                      label="Correct"
                      employeeId={a.employee.id}
                      date={d.date}
                      timezone={tz}
                      sessions={sessions.map((x) => ({ id: x.id, workDate: x.workDate, punchInAt: x.punchInAt, punchOutAt: x.punchOutAt, status: x.status, location: x.location }))}
                      initialKind={d.incomplete ? "CLOSE_SESSION" : undefined}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Audit trail" description="Immutable record of every punch and change." />
            <ol className="max-h-96 space-y-2 overflow-y-auto p-5 text-sm" data-testid="attendance-events">
              {a.events.map((e) => (
                <li key={e.id}>
                  <p className="text-ink">
                    <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span> by {e.actor}
                  </p>
                  <p className="text-xs text-ink-subtle">{formatDateTime(e.occurredAt)}</p>
                </li>
              ))}
              {a.events.length === 0 && <li className="text-ink-subtle">No events this month.</li>}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Corrections" />
            <ul className="divide-y divide-border text-sm">
              {a.corrections.map((c) => (
                <li key={c.id} className="px-5 py-2.5">
                  <p className="font-medium text-ink">
                    {CORRECTION_LABELS[c.kind as keyof typeof CORRECTION_LABELS]} · {formatLongDate(c.workDate)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {c.status.toLowerCase()} · {c.reason}
                    {c.reviewedBy ? ` · by ${c.reviewedBy}` : ""}
                  </p>
                </li>
              ))}
              {a.corrections.length === 0 && <li className="px-5 py-3 text-ink-subtle">None this month.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
