"use client";

import { CircleCheck, CircleSlash, Clock, QrCode, TrendingUp, TriangleAlert, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDirectory } from "@/components/employees/directory-context";
import type { EmployeeListQuery } from "@/features/employees/schema";

export interface KpiStats {
  totalRecords: number;
  active: number;
  inactive: number;
  validCredentials: number;
  expiredIds: number;
  expiringSoon: number;
  newLast30d: number;
  warnDays: number;
}

type Filter = { status: string; credential: string; expiry: string };

interface Kpi {
  key: string;
  testId: string;
  label: string;
  value: number;
  icon: typeof Users;
  filter: Filter;
  /** Tailwind classes: icon bubble, ratio bar, active ring. */
  accent: { bubble: string; bar: string; ring: string; glow: string };
  hint: string;
  trend?: string;
}

const ALL: Filter = { status: "ALL", credential: "ANY", expiry: "ANY" };

function sameFilter(q: Pick<EmployeeListQuery, "status" | "credential" | "expiry">, f: Filter) {
  return q.status === f.status && q.credential === f.credential && q.expiry === f.expiry;
}

/**
 * Interactive KPI cards. Values come from the database (getDashboardStats). Clicking a card
 * replaces the status / QR / validity filters with that card's filter (search, department
 * and sort are kept), and the matching card is highlighted.
 */
export function KpiCards({ stats, query }: { stats: KpiStats; query: Pick<EmployeeListQuery, "status" | "credential" | "expiry"> }) {
  const { navigate, pending } = useDirectory();
  const total = Math.max(stats.totalRecords, 1);
  const kpis: Kpi[] = [
    {
      key: "total",
      testId: "stat-total-records",
      label: "Total Employees",
      value: stats.totalRecords,
      icon: Users,
      filter: ALL,
      accent: { bubble: "from-primary-500 to-violet-600", bar: "bg-primary-500", ring: "ring-primary-500", glow: "from-primary-500/10" },
      hint: "All records, excluding archived",
      trend: stats.newLast30d > 0 ? `+${stats.newLast30d.toLocaleString("en-IN")} in 30 days` : undefined,
    },
    {
      key: "active",
      testId: "stat-active",
      label: "Active",
      value: stats.active,
      icon: CircleCheck,
      filter: { ...ALL, status: "ACTIVE" },
      accent: { bubble: "from-emerald-500 to-teal-600", bar: "bg-emerald-500", ring: "ring-emerald-500", glow: "from-emerald-500/10" },
      hint: "Currently employed",
    },
    {
      key: "inactive",
      testId: "stat-inactive",
      label: "Inactive",
      value: stats.inactive,
      icon: CircleSlash,
      filter: { ...ALL, status: "INACTIVE" },
      accent: { bubble: "from-rose-500 to-red-600", bar: "bg-rose-500", ring: "ring-rose-500", glow: "from-rose-500/10" },
      hint: "QR shows “Inactive”",
    },
    {
      key: "qr",
      testId: "stat-qr-credentials",
      label: "QR Credentials",
      value: stats.validCredentials,
      icon: QrCode,
      filter: { ...ALL, credential: "VALID" },
      accent: { bubble: "from-cyan-500 to-teal-600", bar: "bg-cyan-500", ring: "ring-cyan-500", glow: "from-cyan-500/10" },
      hint: "Valid & unrevoked",
    },
    {
      key: "expired",
      testId: "stat-expired-ids",
      label: "Expired IDs",
      value: stats.expiredIds,
      icon: TriangleAlert,
      filter: { ...ALL, expiry: "EXPIRED" },
      accent: { bubble: "from-red-500 to-rose-700", bar: "bg-red-500", ring: "ring-red-500", glow: "from-red-500/10" },
      hint: "Past ID validity date",
    },
    {
      key: "expiring",
      testId: "stat-expiring-soon",
      label: "Expiring Soon",
      value: stats.expiringSoon,
      icon: Clock,
      filter: { ...ALL, expiry: "EXPIRING_SOON" },
      accent: { bubble: "from-amber-400 to-orange-600", bar: "bg-orange-500", ring: "ring-orange-500", glow: "from-orange-500/10" },
      hint: `Within ${stats.warnDays} days`,
    },
  ];

  return (
    <section aria-label="Summary — select a card to filter the directory" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k, i) => {
        const active = sameFilter(query, k.filter);
        const pct = Math.round((k.value / total) * 100);
        const Icon = k.icon;
        return (
          <button
            key={k.key}
            type="button"
            aria-pressed={active}
            disabled={pending && active}
            onClick={() => navigate(k.filter)}
            style={{ animationDelay: `${i * 35}ms` }}
            className={cn(
              "group animate-rise relative overflow-hidden rounded-[var(--radius-card)] border bg-white p-4 text-left shadow-[var(--shadow-card)] transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]",
              active ? cn("border-transparent ring-2", k.accent.ring) : "border-border",
            )}
          >
            <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent to-60% opacity-0 transition-opacity duration-200 group-hover:opacity-100", k.accent.glow, active && "opacity-100")} aria-hidden />
            <span className="relative flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-ink-muted">{k.label}</span>
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform duration-200 group-hover:scale-105", k.accent.bubble)}>
                <Icon className="size-[18px]" aria-hidden />
              </span>
            </span>
            <span className="relative mt-1 block text-3xl font-semibold tracking-tight text-ink tabular-nums" data-testid={k.testId}>
              {k.value.toLocaleString("en-IN")}
            </span>
            <span className="relative mt-1 flex min-h-4 items-center gap-1 text-xs text-ink-subtle">
              {k.trend ? (
                <>
                  <TrendingUp className="size-3.5 text-emerald-600" aria-hidden />
                  <span className="font-medium text-emerald-700">{k.trend}</span>
                </>
              ) : (
                k.hint
              )}
            </span>
            {k.key !== "total" && (
              <span className="relative mt-3 block" aria-label={`${pct}% of all employees`}>
                <span className="block h-1.5 overflow-hidden rounded-full bg-navy-100">
                  <span className={cn("block h-full rounded-full transition-[width] duration-500", k.accent.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
                </span>
                <span className="mt-1 block text-[11px] text-ink-subtle tabular-nums">{pct}% of total</span>
              </span>
            )}
            {k.key === "total" && <span className="relative mt-3 block text-[11px] text-ink-subtle">{k.hint}</span>}
          </button>
        );
      })}
    </section>
  );
}
