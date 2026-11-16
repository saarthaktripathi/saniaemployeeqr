"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  CalendarCheck2,
  CalendarDays,
  ChevronsLeft,
  CirclePlus,
  Clock,
  CloudUpload,
  History,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Megaphone,
  Menu,
  Settings,
  ShieldCheck,
  Target,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";

const ICONS = {
  directory: Users,
  add: CirclePlus,
  import: CloudUpload,
  activity: History,
  companies: Building2,
  rules: ShieldCheck,
  users: UserCog,
  security: LockKeyhole,
  access: KeyRound,
  home: LayoutDashboard,
  attendance: Clock,
  tasks: ListChecks,
  calendar: CalendarDays,
  leave: CalendarCheck2,
  profile: UserRound,
  notifications: Bell,
  settings: Settings,
  team: UsersRound,
  announce: Megaphone,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

function isActive(pathname: string, href: string) {
  // Workspace home and team overview match exactly; their sections have their own entries.
  if (href === "/me" || href === "/me/team") return pathname === href;
  if (href === "/dashboard") return pathname === "/dashboard" || (pathname.startsWith("/employees/") && !pathname.startsWith("/employees/new") && !pathname.startsWith("/employees/import"));
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition-[background-color,color,box-shadow] duration-200",
              active
                ? "bg-gradient-to-r from-primary-500 to-primary-400 text-white shadow-[0_6px_18px_rgb(58_74_192/0.45)]"
                : "text-white/80 hover:bg-white/[0.07] hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={cn("size-5 shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-white/70 group-hover:text-white")} aria-hidden />
            <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserChip({ name, role, collapsed }: { name: string; role: string; collapsed?: boolean }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className={cn("flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5", collapsed && "justify-center p-2")} title={collapsed ? `${name} · ${role}` : undefined}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-xs font-semibold text-white" aria-hidden>
        {initials}
      </span>
      <span className={cn("min-w-0 leading-tight", collapsed && "sr-only")}>
        <span className="block truncate text-sm font-semibold text-white" data-testid="sidebar-user">
          {name}
        </span>
        <span className="block truncate text-xs text-white/55">{role}</span>
      </span>
    </div>
  );
}

/** Decorative Royal Blue waves and the brand smile curve at the bottom of the sidebar. */
function SidebarArt() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full" viewBox="0 0 260 560" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sb-w1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3A4AC0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#171D4A" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="sb-w2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5E6CCE" stopOpacity="0.4" />
          <stop offset="1" stopColor="#232C71" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <path d="M0 120 C 70 60, 150 170, 260 70 L260 560 L0 560 Z" fill="url(#sb-w1)" />
      <path d="M0 230 C 90 160, 170 290, 260 200 L260 560 L0 560 Z" fill="url(#sb-w2)" />
      <path d="M0 330 C 80 290, 180 380, 260 320 L260 560 L0 560 Z" fill="#0B0E23" opacity="0.5" />
      {/* The brand's "smile" curve (logo rationale, brand book p.9). */}
      <path d="M-10 452 C 60 488, 170 488, 270 420" stroke="#868FDA" strokeWidth="2" fill="none" opacity="0.35" />
    </svg>
  );
}

/** Desktop sidebar. Collapsed state is stored in a cookie so the server renders the right width (no layout shift). */
export function Sidebar({ items, logo, initialCollapsed, homeHref = "/dashboard", quote }: { items: NavItem[]; logo: ReactNode; initialCollapsed: boolean; homeHref?: string; quote?: string }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#030015_0%,#0B0E23_40%,#171D4A_100%)] py-6 transition-[width] duration-300 ease-[var(--ease-out)] lg:flex",
        collapsed ? "w-[80px] px-3" : "w-[260px] px-4",
      )}
      data-collapsed={collapsed}
    >
      <SidebarArt />
      <Link href={homeHref} className={cn("relative mb-8 block rounded-md px-1", collapsed && "[&_.logo-full]:hidden [&_.logo-mark]:grid")}>
        {logo}
      </Link>
      <div className="relative">
        <NavLinks items={items} collapsed={collapsed} />
      </div>
      <div className="relative mt-auto space-y-3">
        {!collapsed && (
          <figure className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-white backdrop-blur-sm">
            <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary-500 shadow-lg">
              <Target className="size-[18px]" aria-hidden />
            </span>
            <blockquote className="mt-3 text-[13px] leading-relaxed text-white/90">{quote ?? "Great teams aren\u2019t built by chance, they\u2019re built by great people."}</blockquote>
            <svg viewBox="0 0 60 10" className="mt-2 ml-auto h-2.5 w-12" fill="none" aria-hidden>
              <path d="M1 7 C 8 1, 14 9, 21 5 S 34 1, 40 6 S 52 9, 59 2" stroke="#ADB4E6" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </figure>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <ChevronsLeft className={cn("size-4 transition-transform duration-300", collapsed && "rotate-180")} aria-hidden />
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

/** Mobile/tablet navigation: a slide-in drawer built on <dialog> (focus trap, Escape to close). */
export function MobileNav({ items, logo, user }: { items: NavItem[]; logo: ReactNode; user: { name: string; role: string } }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const close = () => ref.current?.close();
  useEffect(close, [pathname]);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="Open menu"
        className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-navy-100 hover:text-ink lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        onClick={(e) => e.target === ref.current && close()}
        data-drawer
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] -translate-x-full overflow-hidden bg-[linear-gradient(180deg,#030015_0%,#171D4A_100%)] p-0 text-white transition-[translate,display,overlay] transition-discrete duration-300 ease-[var(--ease-out)] open:translate-x-0 starting:open:-translate-x-full lg:hidden"
      >
        <SidebarArt />
        <div className="relative flex h-full flex-col px-4 py-5">
          <div className="mb-6 flex items-center justify-between">
            {logo}
            <button type="button" onClick={close} aria-label="Close menu" className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <NavLinks items={items} onNavigate={close} />
          <div className="mt-auto">
            <UserChip {...user} />
          </div>
        </div>
      </dialog>
    </>
  );
}
