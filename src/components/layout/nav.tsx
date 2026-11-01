"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronsLeft, FileUp, KeyRound, Menu, ScrollText, Settings2, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";

const ICONS = { directory: Users, add: UserPlus, import: FileUp, activity: Activity, rules: Settings2, users: ScrollText, security: KeyRound };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

function isActive(pathname: string, href: string) {
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
              "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-[background-color,color] duration-200",
              active ? "bg-white/[0.11] text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            <span
              className={cn(
                "absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-cyan-400 to-violet-500 transition-opacity duration-200",
                active ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            <Icon
              className={cn("size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-cyan-300" : "text-white/50 group-hover:text-white/80")}
              aria-hidden
            />
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
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-xs font-semibold text-white" aria-hidden>
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

/** Desktop sidebar. Collapsed state is stored in a cookie so the server renders the right width (no layout shift). */
export function Sidebar({ items, logo, user, initialCollapsed }: { items: NavItem[]; logo: ReactNode; user: { name: string; role: string }; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#0b1736_0%,#0d1a40_55%,#131c4d_100%)] py-5 transition-[width] duration-300 ease-[var(--ease-out)] lg:flex",
        collapsed ? "w-[76px] px-3" : "w-64 px-4",
      )}
      data-collapsed={collapsed}
    >
      <Link href="/dashboard" className={cn("mb-7 block rounded-md px-1", collapsed && "[&_.leading-tight]:hidden")}>
        {logo}
      </Link>
      <NavLinks items={items} collapsed={collapsed} />
      <div className="mt-auto space-y-3">
        {!collapsed && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-3 text-xs text-white/60">
            <p className="flex items-center gap-1.5 font-semibold text-teal-200">
              <ShieldCheck className="size-3.5" aria-hidden /> Restricted HR environment
            </p>
            <p className="mt-1">Access is logged. Handle employee data per company policy.</p>
          </div>
        )}
        <UserChip {...user} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
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
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] -translate-x-full bg-[#0b1736] p-0 text-white transition-[translate,display,overlay] transition-discrete duration-300 ease-[var(--ease-out)] open:translate-x-0 starting:open:-translate-x-full lg:hidden"
      >
        <div className="flex h-full flex-col px-4 py-5">
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
