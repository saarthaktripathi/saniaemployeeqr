import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarCheck2, CalendarX2, Clock, Plane, Users } from "lucide-react";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAttendanceOverview } from "@/server/services/attendance-hr";
import { listLeaveRequests } from "@/server/services/leave";
import { formatLongDate } from "@/lib/time";
import { LEAVE_STATUS_LABELS, LEAVE_STATUS_TONES, type LeaveStatus } from "@/features/leave/schema";
import { AttendanceTable, Kpi } from "@/components/attendance/attendance-ui";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My team" };

export default async function MyTeamPage() {
  const { actor, ctx } = await requireWorkspaceActor();
  if (actor.role !== "TEAM_MANAGER") redirect("/me");
  const [o, leave] = await Promise.all([getAttendanceOverview(db, actor, { sort: "status" }, ctx), listLeaveRequests(db, actor, {}, ctx)]);
  const k = o.kpis;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="My team" title="Team Attendance" description="Everyone who reports to you, directly or through their managers. Updates live as they punch in and out." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Team size" value={k.totalEmployees} tone="bg-navy-100 text-navy-800" icon={<Users className="size-5" aria-hidden />} hint="with a login" />
        <Kpi label="Present" value={k.present} tone="bg-success-50 text-success-700" icon={<CalendarCheck2 className="size-5" aria-hidden />} />
        <Kpi label="Working now" value={k.working} tone="bg-teal-50 text-teal-700" icon={<Clock className="size-5" aria-hidden />} />
        <Kpi label="Not in yet" value={k.absent} tone="bg-danger-50 text-danger-700" icon={<CalendarX2 className="size-5" aria-hidden />} />
        <Kpi label="On leave" value={k.onLeave} tone="bg-violet-50 text-violet-600" icon={<Plane className="size-5" aria-hidden />} />
        <Kpi label="Late" value={k.late} tone="bg-warning-50 text-warning-700" icon={<AlarmClock className="size-5" aria-hidden />} />
      </div>
      <Card>
        <CardHeader title={`Today · ${formatLongDate(o.date)}`} description={`Shift ${o.shift.start}–${o.shift.end}`} actions={<Link href="/me/team/tasks" className="text-sm font-medium text-primary-600 hover:underline">Team tasks →</Link>} />
        <AttendanceTable rows={o.rows} timezone={o.timezone} date={o.date} linkBase="/me/team/members/" emptyTitle="Nobody reports to you yet" />
      </Card>
      <Card>
        <CardHeader title="Team leave" description="Leave is approved by HR; you can see your team's requests here." />
        {leave.items.length === 0 ? (
          <EmptyState title="No leave requests from your team" />
        ) : (
          <ul className="divide-y divide-border">
            {leave.items.slice(0, 15).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium text-ink">{r.employeeName}</span> · {r.leaveType.name} · {formatLongDate(r.startDate)}
                  {r.endDate !== r.startDate ? ` – ${formatLongDate(r.endDate)}` : ""} ({r.days} day{r.days === 1 ? "" : "s"})
                </span>
                <Badge tone={LEAVE_STATUS_TONES[r.status as LeaveStatus]}>{LEAVE_STATUS_LABELS[r.status as LeaveStatus]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
