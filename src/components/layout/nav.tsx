"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileUp, KeyRound, ScrollText, Settings2, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/cn";

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

export function SidebarNav({ items }: { items: NavItem[] }) {
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
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className={cn("size-4", active ? "text-teal-50" : "text-white/55")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:hidden">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap",
            isActive(pathname, item.href) ? "bg-navy-900 text-white" : "bg-white text-ink-muted ring-1 ring-border",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
