import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/authorization/permissions";
import { listCorrections } from "@/server/services/attendance-corrections";
import { getAttendancePolicy } from "@/server/services/attendance-policy";
import { cn } from "@/lib/cn";
import { AttendanceNav } from "@/components/attendance/attendance-nav";
import { CorrectionQueue } from "@/components/attendance/correction-queue";
import { Card, PageHeader } from "@/components/ui/primitives";
import { Pager, withQuery } from "@/components/ui/pager";

export const metadata: Metadata = { title: "Attendance corrections" };

const TABS = [
  ["PENDING", "Pending"],
  ["APPLIED", "Applied"],
  ["REJECTED", "Rejected"],
  ["", "All"],
] as const;

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor, ctx } = await requirePageActor("attendance:read");
  const sp = await searchParams;
  const status = sp.status ?? "PENDING";
  const [data, policy] = await Promise.all([listCorrections(db, actor, { status: status || undefined, page: Number(sp.page ?? 1) }, ctx), getAttendancePolicy(db)]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Attendance Management" title="Attendance Corrections" description="Employees request corrections for missed or wrong punches. Every applied correction keeps the before and after values and is audited." />
      <AttendanceNav current="/attendance/corrections" canPolicy={can(actor, "policy:manage")} pending={data.pending} />
      <Card>
        <nav aria-label="Status" className="flex flex-wrap gap-1 border-b border-border px-4 py-3">
          {TABS.map(([k, label]) => (
            <Link key={label} href={withQuery("/attendance/corrections", { status: k || "" })} aria-current={status === k ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", status === k ? "bg-navy-900 text-white" : "text-ink-muted hover:bg-navy-100")}>
              {label}
            </Link>
          ))}
        </nav>
        <CorrectionQueue items={data.items} canManage={data.canManage} timezone={policy.timezone} />
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} noun="corrections" hrefFor={(p) => withQuery("/attendance/corrections", { status, page: p > 1 ? p : undefined })} />
      </Card>
    </div>
  );
}
