import Link from "next/link";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/attendance", label: "Daily board" },
  { href: "/attendance/history", label: "Attendance history" },
  { href: "/attendance/corrections", label: "Corrections" },
  { href: "/attendance/reports", label: "Monthly reports" },
  { href: "/attendance/policy", label: "Rules & holidays", policy: true },
] as const;

/** Section navigation for Attendance Management (server-rendered, current page highlighted). */
export function AttendanceNav({ current, canPolicy, pending }: { current: string; canPolicy: boolean; pending?: number }) {
  return (
    <nav aria-label="Attendance sections" className="mb-5 flex flex-wrap gap-1 rounded-xl bg-white/80 p-1 shadow-sm">
      {LINKS.filter((l) => !("policy" in l) || canPolicy).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current === l.href ? "page" : undefined}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", current === l.href ? "bg-primary-600 text-white shadow-sm" : "text-ink-muted hover:bg-navy-100 hover:text-ink")}
        >
          {l.label}
          {l.href === "/attendance/corrections" && pending ? <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", current === l.href ? "bg-white/25" : "bg-warning-50 text-warning-700")}>{pending}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
