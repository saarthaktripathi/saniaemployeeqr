import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { getMonthlyReport } from "@/server/services/attendance-hr";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/cn";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { withQuery } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Monthly attendance report" };

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("attendance:read");
  const sp = await searchParams;
  const r = await getMonthlyReport(db, actor, { month: sp.month, q: sp.q, department: sp.department }, ctx);
  const keep = { month: r.month, q: sp.q, department: sp.department };
  const totals = r.rows.reduce((t, x) => ({ present: t.present + x.present, absent: t.absent + x.absent, leave: t.leave + x.leaveDays, late: t.late + x.lateDays }), { present: 0, absent: 0, leave: 0, late: 0 });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Attendance Management" title="Monthly Reports" description="Working days, presence, absence, leave, late arrivals, hours and attendance % per employee." />
      <AttendanceNav current="/attendance/reports" canPolicy={can(actor, "policy:manage")} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-1">
            <Link href={withQuery("/attendance/reports", { ...keep, month: shiftMonth(r.month, -1) })} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <span className="px-2 font-semibold text-ink">{monthLabel(r.month)}</span>
            <Link href={withQuery("/attendance/reports", { ...keep, month: shiftMonth(r.month, 1) })} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          <form action="/attendance/reports" className="flex flex-wrap items-center gap-2" role="search">
            <input type="hidden" name="month" value={r.month} />
            <Input name="q" aria-label="Employee" defaultValue={sp.q ?? ""} placeholder="Name or ID" className="sm:w-44" />
            <Input name="department" aria-label="Department" defaultValue={sp.department ?? ""} placeholder="Department" className="sm:w-40" />
            <Button type="submit" variant="secondary">
              Filter
            </Button>
            {(["csv", "xlsx"] as const).map((f) => (
              <a key={f} href={withQuery("/api/attendance/export", { kind: "monthly", format: f, ...keep })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-white px-3 text-sm font-medium text-ink hover:bg-navy-100/50">
                <Download className="size-4" aria-hidden /> {f === "csv" ? "CSV" : "Excel"}
              </a>
            ))}
          </form>
        </div>
        {r.rows.length === 0 ? (
          <EmptyState title="No employees on the attendance roster" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="monthly-report">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-3 py-3">Department</th>
                  <th className="px-3 py-3 text-right">Working days</th>
                  <th className="px-3 py-3 text-right">Present</th>
                  <th className="px-3 py-3 text-right">Half days</th>
                  <th className="px-3 py-3 text-right">Absent</th>
                  <th className="px-3 py-3 text-right">Leave</th>
                  <th className="px-3 py-3 text-right">Late</th>
                  <th className="px-3 py-3 text-right">Hours</th>
                  <th className="px-4 py-3 text-right">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.rows.map((x) => (
                  <tr key={x.employeeId} className="hover:bg-navy-100/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/attendance/employees/${x.employeeId}?month=${r.month}`} className="font-medium text-ink hover:text-primary-600">
                        {x.name}
                      </Link>
                      <span className="block text-xs text-ink-subtle">{x.employeeCode} · {x.designation}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{x.department}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.workingDays}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.present}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.halfDays}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", x.absent > 0 && "font-semibold text-danger-700")}>{x.absent}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.leaveDays}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.lateDays}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(x.workedSeconds)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", x.attendancePercent !== null && x.attendancePercent < 75 ? "text-danger-700" : "text-ink")}>{x.attendancePercent === null ? "—" : `${x.attendancePercent}%`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border text-sm font-semibold text-ink">
                  <td className="px-4 py-3" colSpan={3}>
                    Totals ({r.rows.length} employees)
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.present}</td>
                  <td />
                  <td className="px-3 py-3 text-right tabular-nums">{totals.absent}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.leave}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.late}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
