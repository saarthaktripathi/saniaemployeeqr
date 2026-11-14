import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getLeaveCalendar, listLeaveRequests } from "@/server/services/leave";
import { getAttendancePolicy } from "@/server/services/attendance-policy";
import { LEAVE_STATUS_LABELS, LEAVE_STATUSES } from "@/features/leave/schema";
import { localDate } from "@/lib/time";
import { cn } from "@/lib/cn";
import { LeaveQueue } from "@/components/leave/leave-queue";
import { LeaveCalendar } from "@/components/leave/leave-calendar";
import { Card, PageHeader } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager, withQuery } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Leave Management" };

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function LeavePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("leave:read");
  const sp = await searchParams;
  const view = sp.view === "calendar" ? "calendar" : "requests";
  const status = sp.status ?? (view === "requests" && sp.status === undefined ? "PENDING" : undefined);
  const tz = (await getAttendancePolicy(db)).timezone;
  const today = localDate(new Date(), tz);
  const list = view === "requests" ? await listLeaveRequests(db, actor, { ...sp, status: status === "ALL" ? undefined : status }, ctx) : null;
  const cal = view === "calendar" ? await getLeaveCalendar(db, actor, sp.month, ctx) : null;
  const tabs = [...LEAVE_STATUSES.map((s) => ({ key: s, label: LEAVE_STATUS_LABELS[s] })), { key: "ALL", label: "All" }];
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="Workforce" title="Leave Management" description="Review leave applications, ask for clarification and see who is away. Approved leave is reflected in attendance automatically." />
      <nav aria-label="Leave views" className="flex gap-1 rounded-xl bg-white/80 p-1 shadow-sm sm:w-fit">
        {[
          ["requests", "Requests"],
          ["calendar", "Leave calendar"],
        ].map(([k, label]) => (
          <Link key={k} href={withQuery("/leave", { view: k === "requests" ? undefined : k })} aria-current={view === k ? "page" : undefined} className={cn("rounded-lg px-4 py-1.5 text-sm font-medium", view === k ? "bg-primary-600 text-white" : "text-ink-muted hover:bg-navy-100")}>
            {label}
          </Link>
        ))}
      </nav>
      {list && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <nav aria-label="Status" className="flex flex-wrap gap-1">
              {tabs.map((t) => (
                <Link key={t.key} href={withQuery("/leave", { status: t.key, q: sp.q })} aria-current={(status ?? "ALL") === t.key ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", (status ?? "ALL") === t.key ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-100")}>
                  {t.label}
                  {t.key === "PENDING" && list.pending > 0 ? <span className="ml-1 rounded-full bg-warning-50 px-1.5 text-xs text-warning-700">{list.pending}</span> : null}
                </Link>
              ))}
            </nav>
            <form action="/leave" className="flex items-center gap-2" role="search">
              <input type="hidden" name="status" value={status ?? "ALL"} />
              <label htmlFor="leave-q" className="sr-only">
                Search
              </label>
              <Input id="leave-q" name="q" defaultValue={sp.q ?? ""} placeholder="Name or employee ID" className="sm:w-56" />
              <Button type="submit" variant="secondary" aria-label="Search">
                <Search className="size-4" aria-hidden />
              </Button>
            </form>
          </div>
          <LeaveQueue items={list.items} canDecide={list.canDecide} />
          <Pager page={list.page} pageSize={list.pageSize} total={list.total} noun="requests" hrefFor={(p) => withQuery("/leave", { status: status ?? "ALL", q: sp.q, page: p > 1 ? p : undefined })} />
        </Card>
      )}
      {cal && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <Link href={withQuery("/leave", { view: "calendar", month: shiftMonth(cal.month, -1) })} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Previous month">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <p className="font-semibold text-ink">{monthLabel(cal.month)}</p>
            <Link href={withQuery("/leave", { view: "calendar", month: shiftMonth(cal.month, 1) })} className="grid size-9 place-items-center rounded-lg hover:bg-navy-100" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          <LeaveCalendar start={cal.start} end={cal.end} today={today} items={cal.items} holidays={cal.holidays} weeklyOffDays={cal.weeklyOffDays} />
        </Card>
      )}
    </div>
  );
}
