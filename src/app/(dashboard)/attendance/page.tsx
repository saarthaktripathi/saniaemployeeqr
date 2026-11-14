import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarCheck2, CalendarX2, Clock, Download, Hourglass, LogOut, Percent, Plane, TriangleAlert, Users } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { getAttendanceOverview } from "@/server/services/attendance-hr";
import { listCorrections } from "@/server/services/attendance-corrections";
import { ATTENDANCE_TABS, LOCATION_LABELS, type AttendanceLocation, type AttendanceTab } from "@/features/attendance/schema";
import { formatClock, formatDuration, formatLongDate } from "@/lib/time";
import { cn } from "@/lib/cn";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { AttendanceTable, Kpi } from "@/components/attendance/attendance-ui";
import { CorrectionButton } from "@/components/attendance/correction-dialog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager, withQuery } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Attendance Management" };

const TAB_LABELS: Record<AttendanceTab, string> = { live: "Live attendance", present: "Present", absent: "Absent", late: "Late arrivals", leave: "On leave", incomplete: "Incomplete" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("attendance:read");
  const sp = await searchParams;
  const [o, queue] = await Promise.all([getAttendanceOverview(db, actor, sp, ctx), listCorrections(db, actor, { status: "PENDING" }, ctx)]);
  const k = o.kpis;
  const isToday = o.date === o.today;
  const keep = { date: isToday ? undefined : o.date, q: sp.q, department: sp.department, company: sp.company, sort: sp.sort, dir: sp.dir };
  const tabHref = (t: AttendanceTab) => withQuery("/attendance", { ...keep, tab: t === "live" ? undefined : t });
  const exportHref = (format: "csv" | "xlsx") => withQuery("/api/attendance/export", { kind: "daily", format, date: o.date, tab: o.tab, q: sp.q, department: sp.department, company: sp.company });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Workforce"
        title="Attendance Management"
        description={`${isToday ? "Live attendance for today" : `Attendance for ${formatLongDate(o.date)}`} · shift ${o.shift.start}–${o.shift.end} (${o.timezone}). Updates automatically as people punch in and out.`}
        actions={
          <form action="/attendance" className="flex items-center gap-2">
            <label htmlFor="att-date" className="sr-only">
              Date
            </label>
            <Input id="att-date" type="date" name="date" defaultValue={o.date} max={o.today} className="sm:w-44" />
            <Button type="submit" variant="secondary">
              Go
            </Button>
            {!isToday && (
              <Link href="/attendance" className="text-sm font-medium text-primary-600 hover:underline">
                Today
              </Link>
            )}
          </form>
        }
      />
      <AttendanceNav current="/attendance" canPolicy={can(actor, "policy:manage")} pending={queue.pending} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="attendance-kpis">
        <Kpi label="Total employees" value={k.totalEmployees} hint="with an active login" tone="bg-navy-100 text-navy-800" icon={<Users className="size-5" aria-hidden />} />
        <Kpi label={isToday ? "Present today" : "Present"} value={k.present} tone="bg-success-50 text-success-700" icon={<CalendarCheck2 className="size-5" aria-hidden />} href={tabHref("present")} testId="kpi-present" />
        <Kpi label={isToday ? "Absent today" : "Absent"} value={k.absent} hint={isToday ? "not punched in yet" : undefined} tone="bg-danger-50 text-danger-700" icon={<CalendarX2 className="size-5" aria-hidden />} href={tabHref("absent")} testId="kpi-absent" />
        <Kpi label="Currently working" value={k.working} tone="bg-teal-50 text-teal-700" icon={<Clock className="size-5" aria-hidden />} href={tabHref("live")} testId="kpi-working" />
        <Kpi label="On leave" value={k.onLeave} tone="bg-violet-50 text-violet-600" icon={<Plane className="size-5" aria-hidden />} href={tabHref("leave")} />
        <Kpi label="Late arrivals" value={k.late} hint={`after ${o.shift.start} + ${o.shift.graceMinutes} min`} tone="bg-warning-50 text-warning-700" icon={<AlarmClock className="size-5" aria-hidden />} href={tabHref("late")} />
        <Kpi label="Early departures" value={k.earlyDepartures} tone="bg-orange-50 text-orange-700" icon={<LogOut className="size-5" aria-hidden />} />
        <Kpi label="Incomplete sessions" value={k.incomplete} hint="missed punch-outs" tone="bg-danger-50 text-danger-700" icon={<TriangleAlert className="size-5" aria-hidden />} href={tabHref("incomplete")} testId="kpi-incomplete" />
        <Kpi label="Average hours" value={formatDuration(k.averageWorkedSeconds)} hint="of those present" tone="bg-primary-50 text-primary-700" icon={<Hourglass className="size-5" aria-hidden />} />
        <Kpi label="Monthly attendance" value={k.monthAttendancePercent === null ? "—" : `${k.monthAttendancePercent}%`} hint="month to date" tone="bg-cyan-50 text-cyan-700" icon={<Percent className="size-5" aria-hidden />} href="/attendance/reports" />
      </div>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <nav aria-label="Attendance tabs" className="flex flex-wrap gap-1">
            {ATTENDANCE_TABS.map((t) => (
              <Link key={t} href={tabHref(t)} aria-current={o.tab === t ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", o.tab === t ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-100 hover:text-ink")}>
                {TAB_LABELS[t]}
              </Link>
            ))}
          </nav>
          <div className="flex gap-2">
            <a href={exportHref("csv")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-white px-3 text-sm font-medium text-ink hover:bg-navy-100/50">
              <Download className="size-4" aria-hidden /> CSV
            </a>
            <a href={exportHref("xlsx")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-white px-3 text-sm font-medium text-ink hover:bg-navy-100/50">
              <Download className="size-4" aria-hidden /> Excel
            </a>
          </div>
        </div>
        {o.tab !== "incomplete" && (
          <form action="/attendance" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3" role="search">
            {!isToday && <input type="hidden" name="date" value={o.date} />}
            {o.tab !== "live" && <input type="hidden" name="tab" value={o.tab} />}
            <label htmlFor="att-q" className="sr-only">
              Search
            </label>
            <Input id="att-q" name="q" defaultValue={sp.q ?? ""} placeholder="Name or employee ID" className="sm:w-56" />
            <label htmlFor="att-dept" className="sr-only">
              Department
            </label>
            <Select id="att-dept" name="department" defaultValue={sp.department ?? ""} className="sm:w-48">
              <option value="">All departments</option>
              {o.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            {o.companies.length > 1 && (
              <>
                <label htmlFor="att-company" className="sr-only">
                  Company
                </label>
                <Select id="att-company" name="company" defaultValue={sp.company ?? ""} className="sm:w-48">
                  <option value="">All companies</option>
                  {o.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <label htmlFor="att-sort" className="sr-only">
              Sort
            </label>
            <Select id="att-sort" name="sort" defaultValue={sp.sort ?? "status"} className="sm:w-40">
              <option value="status">Sort: status</option>
              <option value="name">Sort: name</option>
              <option value="in">Sort: punch in</option>
              <option value="out">Sort: punch out</option>
              <option value="worked">Sort: hours</option>
            </Select>
            <Select aria-label="Direction" name="dir" defaultValue={sp.dir ?? "asc"} className="sm:w-28">
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </Select>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
        )}
        {o.tab === "incomplete" ? (
          o.incomplete.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-muted">No incomplete sessions. Everyone punched out.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="incomplete-list">
              {o.incomplete.map((s) => (
                <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <Link href={`/attendance/employees/${s.employeeId}?month=${s.workDate.slice(0, 7)}`} className="font-medium text-ink hover:text-primary-600">
                      {s.name}
                    </Link>{" "}
                    <span className="text-xs text-ink-subtle">
                      {s.employeeCode} · {s.department}
                    </span>
                    <p className="text-sm text-ink-muted">
                      {formatLongDate(s.workDate)} · in {formatClock(s.punchInAt, o.timezone)}
                      {s.punchOutAt ? ` · out ${formatClock(s.punchOutAt, o.timezone)}` : ""} · {LOCATION_LABELS[s.location as AttendanceLocation]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.reason === "MISSED_PUNCH_OUT" ? "danger" : "warning"}>{s.reason === "MISSED_PUNCH_OUT" ? "Missed punch-out" : "Needs review"}</Badge>
                    {o.canManage && (
                      <CorrectionButton
                        label="Resolve"
                        variant="primary"
                        employeeId={s.employeeId}
                        date={s.workDate}
                        timezone={o.timezone}
                        sessions={[{ id: s.sessionId, workDate: s.workDate, punchInAt: s.punchInAt, punchOutAt: s.punchOutAt, status: s.reason === "MISSED_PUNCH_OUT" ? "OPEN" : "CLOSED", location: s.location }]}
                        initialKind={s.reason === "MISSED_PUNCH_OUT" ? "CLOSE_SESSION" : "CHANGE_TIMES"}
                        initialSessionId={s.sessionId}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <AttendanceTable rows={o.rows} timezone={o.timezone} date={o.date} emptyTitle={o.tab === "live" ? "Nobody on the roster yet" : `No one in “${TAB_LABELS[o.tab]}”`} />
            <Pager page={o.page} pageSize={o.pageSize} total={o.total} noun="employees" hrefFor={(p) => withQuery("/attendance", { ...keep, tab: o.tab === "live" ? undefined : o.tab, page: p > 1 ? p : undefined })} />
          </>
        )}
      </Card>
      {o.kpis.totalEmployees === 0 && (
        <Card className="mt-5">
          <CardHeader title="No one can punch in yet" description="Attendance covers employees who have a login. Invite employees from Employee Access to start tracking attendance." />
          <div className="p-5">
            <Link href="/accounts?state=none" className="text-sm font-medium text-primary-600 hover:underline">
              Go to Employee Access →
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
