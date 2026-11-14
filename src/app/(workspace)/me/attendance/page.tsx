import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, Clock, Plane } from "lucide-react";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyAttendanceMonth } from "@/server/services/attendance";
import { addDays, formatClock, formatDuration, formatLongDate } from "@/lib/time";
import { CORRECTION_LABELS, LOCATION_LABELS, type AttendanceLocation } from "@/features/attendance/schema";
import { DayStatusBadge, Kpi, MonthGrid } from "@/components/attendance/attendance-ui";
import { CorrectionButton } from "@/components/attendance/correction-dialog";
import { CancelCorrectionButton } from "@/components/attendance/cancel-correction-button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My attendance" };

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor } = await requireWorkspaceActor();
  const sp = await searchParams;
  const data = await getMyAttendanceMonth(db, actor, sp.month);
  const tz = data.timezone;
  const s = data.stats;
  const windowStart = addDays(data.today, -data.correctionWindowDays);
  const visibleDays = [...data.days].reverse().filter((d) => d.date <= data.today && d.status !== "NOT_EMPLOYED");
  const label = new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        eyebrow="Employee workspace"
        title="My Attendance"
        description={`Your punches, working hours and attendance for ${label}. Times are shown in ${tz}.`}
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-white/80 p-1 shadow-sm">
            <Link href={`/me/attendance?month=${shiftMonth(data.month, -1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="px-2 text-sm font-semibold text-ink">{label}</span>
            <Link href={`/me/attendance?month=${shiftMonth(data.month, 1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Present days" value={s.present + s.halfDays * 0.5} tone="bg-success-50 text-success-700" icon={<CalendarCheck2 className="size-5" aria-hidden />} hint={s.halfDays ? `incl. ${s.halfDays} half day(s)` : undefined} />
        <Kpi label="Absent days" value={s.absent} tone="bg-danger-50 text-danger-700" icon={<CalendarX2 className="size-5" aria-hidden />} hint={s.lateDays ? `${s.lateDays} late arrival(s)` : undefined} />
        <Kpi label="Leave days" value={s.leaveDays} tone="bg-violet-50 text-violet-600" icon={<Plane className="size-5" aria-hidden />} />
        <Kpi label="Hours worked" value={formatDuration(s.workedSeconds)} tone="bg-primary-50 text-primary-700" icon={<Clock className="size-5" aria-hidden />} hint={s.attendancePercent === null ? undefined : `${s.attendancePercent}% attendance`} />
      </div>

      <Card className="p-4 sm:p-5">
        <MonthGrid days={data.days} today={data.today} hrefFor={(d) => `#day-${d}`} />
      </Card>

      <Card>
        <CardHeader title="Day by day" description={`You can request corrections for the last ${data.correctionWindowDays} days. Older changes go through HR.`} />
        <ul className="divide-y divide-border" data-testid="my-days">
          {visibleDays.map((d) => {
            const sessions = data.sessions.filter((x) => x.workDate === d.date);
            const canRequest = d.date >= windowStart;
            return (
              <li key={d.date} id={`day-${d.date}`} className="flex scroll-mt-24 flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {formatLongDate(d.date)} <DayStatusBadge status={d.status} />
                    {d.late && <Badge tone="warning">Late {d.lateMinutes}m</Badge>}
                    {d.earlyLeave && <Badge tone="orange">Left {d.earlyMinutes}m early</Badge>}
                    {d.incomplete && <Badge tone="danger">Missed punch-out</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {sessions.length
                      ? sessions
                          .map((x) => `${formatClock(x.punchInAt, tz)}–${x.punchOutAt ? formatClock(x.punchOutAt, tz) : "open"} (${LOCATION_LABELS[x.location as AttendanceLocation]}${x.status === "CORRECTED" ? ", corrected" : x.status === "VOIDED" ? ", removed" : ""})`)
                          .join(" · ")
                      : "No punches"}
                    {d.workedSeconds > 0 && <span className="ml-2 font-medium text-ink">{formatDuration(d.workedSeconds)}</span>}
                  </p>
                </div>
                {canRequest && (
                  <CorrectionButton
                    date={d.date}
                    timezone={tz}
                    sessions={sessions.map((x) => ({ id: x.id, workDate: x.workDate, punchInAt: x.punchInAt, punchOutAt: x.punchOutAt, status: x.status, location: x.location }))}
                    initialKind={d.incomplete ? "CLOSE_SESSION" : undefined}
                  />
                )}
              </li>
            );
          })}
          {visibleDays.length === 0 && <li className="px-5 py-8 text-center text-sm text-ink-muted">No days to show for this month yet.</li>}
        </ul>
      </Card>

      {data.corrections.length > 0 && (
        <Card>
          <CardHeader title="My correction requests" />
          <ul className="divide-y divide-border" data-testid="my-corrections">
            {data.corrections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">
                    {CORRECTION_LABELS[c.kind]} · {formatLongDate(c.workDate)}
                  </p>
                  <p className="text-ink-muted">
                    {c.reason}
                    {c.reviewNote ? ` · HR: ${c.reviewNote}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={c.status === "APPLIED" ? "success" : c.status === "REJECTED" ? "danger" : c.status === "PENDING" ? "warning" : "neutral"}>{c.status === "APPLIED" ? "Approved" : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
                  {c.status === "PENDING" && <CancelCorrectionButton id={c.id} />}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
