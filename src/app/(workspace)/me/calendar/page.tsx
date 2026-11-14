import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/server/db/client";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getMyAttendanceMonth } from "@/server/services/attendance";
import { getMyTasks } from "@/server/services/tasks";
import { getMyLeave } from "@/server/services/leave";
import { listHolidays } from "@/server/services/attendance-policy";
import { monthBounds } from "@/lib/time";
import { MonthGrid } from "@/components/attendance/attendance-ui";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My calendar" };

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor } = await requireWorkspaceActor();
  const sp = await searchParams;
  const attendance = await getMyAttendanceMonth(db, actor, sp.month);
  const { start, end } = monthBounds(attendance.month);
  const [tasks, leave, holidays] = await Promise.all([getMyTasks(db, actor, "all"), getMyLeave(db, actor, attendance.month.slice(0, 4)), listHolidays(db, start, end)]);
  const due = new Map<string, string[]>();
  for (const t of tasks.items) if (t.dueDate && t.dueDate >= start && t.dueDate <= end && t.status !== "CANCELLED") due.set(t.dueDate, [...(due.get(t.dueDate) ?? []), t.title]);
  const leaveOn = (d: string) => leave.requests.find((r) => (r.status === "APPROVED" || r.status === "PENDING") && r.startDate <= d && r.endDate >= d);
  const holidayOn = new Map(holidays.map((h) => [h.date, h.name]));
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        eyebrow="Employee workspace"
        title="My Calendar"
        description="Attendance, task due dates, leave and holidays in one view."
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-white/80 p-1 shadow-sm">
            <Link href={`/me/calendar?month=${shiftMonth(attendance.month, -1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="px-2 text-sm font-semibold text-ink">{monthLabel(attendance.month)}</span>
            <Link href={`/me/calendar?month=${shiftMonth(attendance.month, 1)}`} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        }
      />
      <Card className="p-4 sm:p-5">
        <MonthGrid
          days={attendance.days}
          today={attendance.today}
          extra={(d) => (
            <span className="mt-1 hidden space-y-0.5 sm:block">
              {holidayOn.has(d) && <span className="block truncate text-[10px] font-medium text-primary-700">{holidayOn.get(d)}</span>}
              {leaveOn(d) && <span className="block truncate text-[10px] font-medium text-violet-700">{leaveOn(d)!.leaveType.code}{leaveOn(d)!.status === "PENDING" ? " (pending)" : ""}</span>}
              {(due.get(d) ?? []).slice(0, 2).map((t) => (
                <span key={t} className="block truncate rounded bg-white/70 px-1 text-[10px] text-ink">
                  Due: {t}
                </span>
              ))}
            </span>
          )}
        />
      </Card>
      <p className="text-xs text-ink-subtle">Tip: open My Tasks for the task calendar and My Leave to apply for leave.</p>
    </div>
  );
}
