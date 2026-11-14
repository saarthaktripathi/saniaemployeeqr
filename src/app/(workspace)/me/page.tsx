import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, CalendarX2, Clock, ListChecks, ListTodo, TimerOff, TriangleAlert, Plane } from "lucide-react";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyAttendanceMonth, getMyAttendanceToday } from "@/server/services/attendance";
import { getMyProfile } from "@/server/services/me";
import { getMyTaskStats } from "@/server/services/tasks";
import { AttendanceCard } from "@/components/workspace/attendance-card";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { Card, PageHeader } from "@/components/ui/primitives";
import { EMPLOYMENT_TYPE_LABELS } from "@/features/employees/labels";
import { formatDuration } from "@/lib/time";

export const metadata: Metadata = { title: "My dashboard" };

function Stat({ icon, label, value, tone, href }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string; href?: string }) {
  const body = (
    <Card className="flex h-full items-center gap-3 p-4 transition-shadow hover:shadow-[0_8px_28px_rgb(30_41_90/0.10)]">
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink-muted">{label}</span>
        <span className="block text-xl font-bold text-ink tabular-nums">{value}</span>
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

export default async function MyDashboardPage() {
  const { actor } = await requireWorkspaceActor();
  const [profile, today, month, tasks] = await Promise.all([getMyProfile(db, actor), getMyAttendanceToday(db, actor), getMyAttendanceMonth(db, actor), getMyTaskStats(db, actor)]);
  const s = month.stats;
  const first = profile.firstName || profile.displayName.split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="Employee workspace" title={`Welcome, ${first}`} description="Your attendance, tasks and leave in one place." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <AttendanceCard initial={today} employee={{ name: profile.displayName, code: profile.employeeCode }} />
        </div>
        <Card className="min-w-0 p-5" data-testid="my-profile-card">
          <div className="flex items-center gap-4">
            <EmployeeAvatar id={profile.id} name={profile.displayName} photoUpdatedAt={profile.photoUpdatedAt} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-ink">{profile.displayName}</p>
              <p className="text-sm text-ink-muted">{profile.employeeCode}</p>
              <p className="text-xs text-ink-subtle">{profile.company}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-2.5 text-sm">
            {[
              ["Department", profile.department],
              ["Designation", profile.jobTitle],
              ["Reporting manager", profile.reportingManager ? `${profile.reportingManager.displayName}` : "—"],
              ["Employment", `${profile.employmentStatus === "ACTIVE" ? "Active" : "Inactive"}${profile.employmentType ? ` · ${EMPLOYMENT_TYPE_LABELS[profile.employmentType]}` : ""}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="truncate text-right font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <Link href="/me/profile" className="mt-4 inline-block text-sm font-medium text-primary-600 hover:underline">
            View my profile →
          </Link>
        </Card>
      </div>

      <section aria-label="This month" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">This month</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="month-stats">
          <Stat icon={<CalendarCheck2 className="size-5" aria-hidden />} tone="bg-success-50 text-success-700" label="Present days" value={s.present + s.halfDays * 0.5} href="/me/attendance" />
          <Stat icon={<CalendarX2 className="size-5" aria-hidden />} tone="bg-danger-50 text-danger-700" label="Absent days" value={s.absent} href="/me/attendance" />
          <Stat icon={<Plane className="size-5" aria-hidden />} tone="bg-violet-50 text-violet-600" label="Leave days" value={s.leaveDays} href="/me/leave" />
          <Stat icon={<Clock className="size-5" aria-hidden />} tone="bg-primary-50 text-primary-700" label="Hours worked" value={formatDuration(s.workedSeconds)} href="/me/attendance" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="task-stats">
          <Stat icon={<ListTodo className="size-5" aria-hidden />} tone="bg-orange-50 text-orange-700" label="Pending tasks" value={tasks.pending} href="/me/tasks?view=pending" />
          <Stat icon={<ListChecks className="size-5" aria-hidden />} tone="bg-teal-50 text-teal-700" label="Completed tasks" value={tasks.completed} href="/me/tasks?view=completed" />
          <Stat icon={<TriangleAlert className="size-5" aria-hidden />} tone="bg-danger-50 text-danger-700" label="Overdue tasks" value={tasks.overdue} href="/me/tasks?view=overdue" />
          <Stat icon={<TimerOff className="size-5" aria-hidden />} tone="bg-warning-50 text-warning-700" label="Attendance" value={s.attendancePercent === null ? "—" : `${s.attendancePercent}%`} href="/me/attendance" />
        </div>
      </section>
    </div>
  );
}
