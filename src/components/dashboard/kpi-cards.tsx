"use client";

import { ArrowDown, ArrowUp, CircleCheck, CircleX, Clock, QrCode, TriangleAlert, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDirectory } from "@/components/employees/directory-context";
import type { EmployeeListQuery } from "@/features/employees/schema";
import { Sparkline } from "./sparkline";

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

export type KpiTrends = Record<"total" | "active" | "inactive" | "qr" | "expired" | "expiring", number[]>;

type Filter = { status: string; credential: string; expiry: string };

interface Tone {
  card: string;
  icon: string;
  ring: string;
  line: string;
}

/** Pastel per-card palettes (background tint, icon disc, selection ring, chart colour). */
const TONES: Record<string, Tone> = {
  blue: { card: "from-[#eef3ff] to-white border-[#dfe7ff]", icon: "bg-[#e3eaff] text-[#3b5bdb]", ring: "ring-[#4c6ef5]", line: "#4c6ef5" },
  green: { card: "from-[#eafaf1] to-white border-[#d3f2e1]", icon: "bg-[#d6f5e3] text-[#12a150]", ring: "ring-[#12b886]", line: "#20c997" },
  red: { card: "from-[#fff0f1] to-white border-[#ffdfe2]", icon: "bg-[#ffe0e3] text-[#e03140]", ring: "ring-[#f03e3e]", line: "#f06576" },
  purple: { card: "from-[#f5f0ff] to-white border-[#e9e0ff]", icon: "bg-[#ece3ff] text-[#7c3aed]", ring: "ring-[#845ef7]", line: "#9775fa" },
  amber: { card: "from-[#fff7e8] to-white border-[#ffecc7]", icon: "bg-[#ffeec8] text-[#e8890c]", ring: "ring-[#fd7e14]", line: "#fab005" },
  teal: { card: "from-[#e8f9fb] to-white border-[#cff1f5]", icon: "bg-[#d3f3f7] text-[#0c8599]", ring: "ring-[#15aabf]", line: "#22b8cf" },
};

const ALL: Filter = { status: "ALL", credential: "ANY", expiry: "ANY" };

function sameFilter(q: Pick<EmployeeListQuery, "status" | "credential" | "expiry">, f: Filter) {
  return q.status === f.status && q.credential === f.credential && q.expiry === f.expiry;
}

/** Week-over-week change from the last two points of real history. */
function Trend({ series }: { series: number[] }) {
  const now = series[series.length - 1] ?? 0;
  const prev = series[series.length - 2] ?? now;
  if (now === prev) return <span className="text-ink-subtle">No change this week</span>;
  const up = now > prev;
  const label = prev === 0 ? `+${now} this week` : `${Math.round((Math.abs(now - prev) / prev) * 100)}% this week`;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-emerald-600" : "text-rose-600")}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? "Up" : "Down"} </span>
      {label}
    </span>
  );
}

/**
 * Interactive KPI cards. Values and sparklines come from the database. Clicking a card
 * replaces the status / QR / validity filters with that card's filter (search, department
 * and sort are kept), and the matching card is highlighted.
 */
export function KpiCards({ stats, trends, query }: { stats: KpiStats; trends: KpiTrends; query: Pick<EmployeeListQuery, "status" | "credential" | "expiry"> }) {
  const { navigate, pending } = useDirectory();
  const kpis = [
    { key: "total", testId: "stat-total-records", label: "Total Employees", value: stats.totalRecords, icon: Users, filter: ALL, tone: TONES.blue, hint: "Excludes archived", series: trends.total },
    { key: "active", testId: "stat-active", label: "Active", value: stats.active, icon: CircleCheck, filter: { ...ALL, status: "ACTIVE" }, tone: TONES.green, hint: "Currently employed", series: trends.active },
    { key: "inactive", testId: "stat-inactive", label: "Inactive", value: stats.inactive, icon: CircleX, filter: { ...ALL, status: "INACTIVE" }, tone: TONES.red, hint: "QR shows “Inactive”", series: trends.inactive },
    { key: "qr", testId: "stat-qr-credentials", label: "QR Credentials", value: stats.validCredentials, icon: QrCode, filter: { ...ALL, credential: "VALID" }, tone: TONES.purple, hint: "Valid & unrevoked", series: trends.qr },
    { key: "expired", testId: "stat-expired-ids", label: "Expired IDs", value: stats.expiredIds, icon: TriangleAlert, filter: { ...ALL, expiry: "EXPIRED" }, tone: TONES.amber, hint: "Past ID validity date", series: trends.expired },
    { key: "expiring", testId: "stat-expiring-soon", label: "Expiring Soon", value: stats.expiringSoon, icon: Clock, filter: { ...ALL, expiry: "EXPIRING_SOON" }, tone: TONES.teal, hint: `Within ${stats.warnDays} days`, series: trends.expiring },
  ];

  return (
    <section aria-label="Summary — select a card to filter the directory" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {kpis.map((k, i) => {
        const active = sameFilter(query, k.filter);
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
              "group animate-rise relative flex min-h-[132px] flex-col overflow-hidden rounded-2xl border bg-gradient-to-br p-4 text-left shadow-[0_2px_10px_rgb(30_41_90/0.05)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgb(30_41_90/0.12)]",
              k.tone.card,
              active && cn("ring-2 ring-offset-2 ring-offset-page", k.tone.ring),
            )}
          >
            <span className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-ink">{k.label}</span>
              <span className={cn("order-first grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 group-hover:scale-110", k.tone.icon)}>
                <Icon className="size-[18px]" aria-hidden />
              </span>
            </span>
            <span className="mt-auto flex items-end justify-between gap-2 pt-2">
              <span className="min-w-0">
                <span className="block text-[28px] leading-none font-bold tracking-tight text-ink tabular-nums" data-testid={k.testId}>
                  {k.value.toLocaleString("en-IN")}
                </span>
                <span className="mt-1.5 hidden truncate text-xs text-ink-muted sm:block">{k.hint}</span>
                <span className="mt-1.5 block text-[11px] whitespace-nowrap sm:mt-1">
                  <Trend series={k.series} />
                </span>
              </span>
              <Sparkline values={k.series} color={k.tone.line} id={k.key} className="h-9 w-[34%] max-w-24 shrink-0 sm:w-[40%]" />
            </span>
          </button>
        );
      })}
    </section>
  );
}
