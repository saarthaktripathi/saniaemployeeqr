"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsLeft, CirclePlus, CloudUpload, History, LockKeyhole, Menu, ShieldCheck, Target, UserCog, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";

const ICONS = { directory: Users, add: CirclePlus, import: CloudUpload, activity: History, rules: ShieldCheck, users: UserCog, security: LockKeyhole };

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
              "group relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition-[background-color,color,box-shadow] duration-200",
              active
                ? "bg-gradient-to-r from-[#4f55e6] to-[#6b5cf0] text-white shadow-[0_6px_18px_rgb(79_85_230/0.45)]"
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

/** Decorative purple waves and a leaf at the bottom of the sidebar. */
function SidebarArt() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full" viewBox="0 0 260 560" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sb-w1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3a9e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1b1f5e" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="sb-w2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d5ae6" stopOpacity="0.45" />
          <stop offset="1" stopColor="#24296e" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="sb-leaf" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0f766e" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <path d="M0 120 C 70 60, 150 170, 260 70 L260 560 L0 560 Z" fill="url(#sb-w1)" />
      <path d="M0 230 C 90 160, 170 290, 260 200 L260 560 L0 560 Z" fill="url(#sb-w2)" />
      <path d="M0 330 C 80 290, 180 380, 260 320 L260 560 L0 560 Z" fill="#141a52" opacity="0.55" />
      <g opacity="0.85">
        <path d="M-6 420 C 18 360, 52 330, 74 318 C 66 362, 40 398, -6 420 Z" fill="url(#sb-leaf)" />
        <path d="M-10 470 C 10 430, 40 410, 62 404 C 50 440, 22 462, -10 470 Z" fill="url(#sb-leaf)" opacity="0.8" />
        <path d="M-6 420 L 74 318 M-10 470 L 62 404" stroke="#99f6e4" strokeWidth="1" opacity="0.4" />
      </g>
    </svg>
  );
}

/** Desktop sidebar. Collapsed state is stored in a cookie so the server renders the right width (no layout shift). */
export function Sidebar({ items, logo, initialCollapsed }: { items: NavItem[]; logo: ReactNode; initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#0b1437_0%,#0e1847_55%,#151c58_100%)] py-6 transition-[width] duration-300 ease-[var(--ease-out)] lg:flex",
        collapsed ? "w-[80px] px-3" : "w-[260px] px-4",
      )}
      data-collapsed={collapsed}
    >
      <SidebarArt />
      <Link href="/dashboard" className={cn("relative mb-8 block rounded-md px-1", collapsed && "[&_.leading-tight]:hidden")}>
        {logo}
      </Link>
      <div className="relative">
        <NavLinks items={items} collapsed={collapsed} />
      </div>
      <div className="relative mt-auto space-y-3">
        {!collapsed && (
          <figure className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-white backdrop-blur-sm">
            <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#6d6af5] to-[#8b5cf6] shadow-lg">
              <Target className="size-[18px]" aria-hidden />
            </span>
            <blockquote className="mt-3 text-[13px] leading-relaxed text-white/90">Great teams aren&apos;t built by chance, they&apos;re built by great people.</blockquote>
            <svg viewBox="0 0 60 10" className="mt-2 ml-auto h-2.5 w-12" fill="none" aria-hidden>
              <path d="M1 7 C 8 1, 14 9, 21 5 S 34 1, 40 6 S 52 9, 59 2" stroke="#818cf8" strokeWidth="1.6" strokeLinecap="round" />
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
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] -translate-x-full overflow-hidden bg-[linear-gradient(180deg,#0b1437_0%,#151c58_100%)] p-0 text-white transition-[translate,display,overlay] transition-discrete duration-300 ease-[var(--ease-out)] open:translate-x-0 starting:open:-translate-x-full lg:hidden"
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
