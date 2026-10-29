import { CircleCheck, CircleSlash, Clock, QrCode, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { DashboardStats } from "@/server/services/dashboard";

function Stat({ label, value, icon: Icon, tone, href, hint }: { label: string; value: number; icon: typeof Users; tone: string; href?: string; hint?: string }) {
  const body = (
    <Card className={cn("h-full p-4 transition-shadow", href && "hover:shadow-md")}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <span className={cn("rounded-lg p-2", tone)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value.toLocaleString("en-IN")}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
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

export function StatCards({ stats }: { stats: DashboardStats }) {
  return (
    <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Total Records" value={stats.totalRecords} icon={Users} tone="bg-navy-100 text-navy-800" href="/dashboard" hint="Excludes archived" />
      <Stat label="Active" value={stats.active} icon={CircleCheck} tone="bg-success-50 text-success-700" href="/dashboard?status=ACTIVE" />
      <Stat label="Inactive" value={stats.inactive} icon={CircleSlash} tone="bg-danger-50 text-danger-700" href="/dashboard?status=INACTIVE" />
      <Stat label="QR Credentials" value={stats.validCredentials} icon={QrCode} tone="bg-teal-50 text-teal-700" href="/dashboard?credential=VALID" hint="Valid & unrevoked" />
      <Stat label="Expired IDs" value={stats.expiredIds} icon={TriangleAlert} tone="bg-danger-50 text-danger-700" href="/dashboard?expiry=EXPIRED" />
      <Stat label="Expiring Soon" value={stats.expiringSoon} icon={Clock} tone="bg-warning-50 text-warning-700" href="/dashboard?expiry=EXPIRING_SOON" hint={`Within ${stats.warnDays} days`} />
    </section>
  );
}

const RESULT_LABELS: Record<string, string> = {
  VERIFIED: "Verified",
  INACTIVE: "Inactive",
  ID_EXPIRED: "ID expired",
  CREDENTIAL_EXPIRED: "QR expired",
  REVOKED: "Revoked",
  UNKNOWN: "Unknown",
  MALFORMED: "Malformed",
};

function Bars({ items, color }: { items: { label: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <p className="text-sm text-ink-subtle">No data yet.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-ink">{i.label}</span>
            <span className="text-ink-muted tabular-nums">{i.count.toLocaleString("en-IN")}</span>
          </div>
          <div className="h-2 rounded-full bg-navy-100" aria-hidden>
            <div className={cn("h-2 rounded-full", color)} style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Insights({ stats }: { stats: DashboardStats }) {
  return (
    <section aria-label="Insights" className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader eyebrow="Workforce" title="Records by department" description="Top departments, excluding archived records." />
        <div className="p-5">
          <Bars items={stats.departments.map((d) => ({ label: d.department, count: d.count }))} color="bg-primary-600" />
        </div>
      </Card>
      <Card>
        <CardHeader eyebrow="Verification" title="Public checks, last 7 days" description="Results of QR scans by verifiers." />
        <div className="p-5">
          <Bars
            items={stats.verifications7d.map((v) => ({ label: RESULT_LABELS[v.result] ?? v.result, count: v.count }))}
            color="bg-teal-600"
          />
        </div>
      </Card>
    </section>
  );
}
