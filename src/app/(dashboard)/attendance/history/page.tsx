import type { Metadata } from "next";
import { Download } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { getAttendanceHistory } from "@/server/services/attendance-hr";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { AttendanceTable } from "@/components/attendance/attendance-ui";
import { Card, PageHeader } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager, withQuery } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Attendance history" };

export default async function AttendanceHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("attendance:read");
  const sp = await searchParams;
  const h = await getAttendanceHistory(db, actor, sp, ctx);
  const keep = { from: h.from, to: h.to, q: sp.q, department: sp.department };
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Attendance Management" title="Attendance History" description="One row per employee per day. Up to 62 days at a time; export for longer analysis." />
      <AttendanceNav current="/attendance/history" canPolicy={can(actor, "policy:manage")} />
      <Card>
        <form action="/attendance/history" className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3" role="search">
          <label className="text-xs font-medium text-ink-muted">
            From
            <Input type="date" name="from" defaultValue={h.from} max={h.today} className="mt-1 sm:w-40" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            To
            <Input type="date" name="to" defaultValue={h.to} max={h.today} className="mt-1 sm:w-40" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Employee
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name or ID" className="mt-1 sm:w-48" />
          </label>
          <label className="text-xs font-medium text-ink-muted">
            Department
            <Input name="department" defaultValue={sp.department ?? ""} placeholder="Any" className="mt-1 sm:w-40" />
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
          <span className="ml-auto flex gap-2">
            {(["csv", "xlsx"] as const).map((f) => (
              <a key={f} href={withQuery("/api/attendance/export", { kind: "history", format: f, ...keep })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-white px-3 text-sm font-medium text-ink hover:bg-navy-100/50">
                <Download className="size-4" aria-hidden /> {f === "csv" ? "CSV" : "Excel"}
              </a>
            ))}
          </span>
        </form>
        <AttendanceTable rows={h.rows} timezone={h.timezone} showDate emptyTitle="No attendance in this range" />
        <Pager page={h.page} pageSize={h.pageSize} total={h.total} noun="employee-days" hrefFor={(p) => withQuery("/attendance/history", { ...keep, page: p > 1 ? p : undefined })} />
      </Card>
    </div>
  );
}
