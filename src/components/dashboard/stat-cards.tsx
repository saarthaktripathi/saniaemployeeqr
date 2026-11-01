import { Card, CardHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { DashboardStats } from "@/server/services/dashboard";

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
