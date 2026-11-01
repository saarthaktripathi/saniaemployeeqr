import { Card, CardHeader } from "@/components/ui/primitives";
import { departmentAccent } from "@/components/employees/department-style";
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

const RESULT_COLORS: Record<string, string> = {
  VERIFIED: "#20c997",
  INACTIVE: "#f06576",
  ID_EXPIRED: "#fab005",
  CREDENTIAL_EXPIRED: "#fd7e14",
  REVOKED: "#e03140",
  UNKNOWN: "#9775fa",
  MALFORMED: "#868e96",
};

function Bars({ items }: { items: { label: string; count: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <p className="text-sm text-ink-subtle">No data yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="flex items-center gap-2 font-medium text-ink">
              <span className="size-2 rounded-full" style={{ background: i.color }} aria-hidden />
              {i.label}
            </span>
            <span className="text-ink-muted tabular-nums">{i.count.toLocaleString("en-IN")}</span>
          </div>
          <div className="h-2 rounded-full bg-navy-100/80" aria-hidden>
            <div className="h-2 rounded-full transition-[width] duration-500" style={{ width: `${(i.count / max) * 100}%`, background: `linear-gradient(90deg, ${i.color}99, ${i.color})` }} />
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
          <Bars items={stats.departments.map((d) => ({ label: d.department, count: d.count, color: departmentAccent(d.department) }))} />
        </div>
      </Card>
      <Card>
        <CardHeader eyebrow="Verification" title="Public checks, last 7 days" description="Results of QR scans by verifiers." />
        <div className="p-5">
          <Bars items={stats.verifications7d.map((v) => ({ label: RESULT_LABELS[v.result] ?? v.result, count: v.count, color: RESULT_COLORS[v.result] ?? "#4c6ef5" }))} />
        </div>
      </Card>
    </section>
  );
}
