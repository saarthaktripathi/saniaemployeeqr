import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { MobileNav, SidebarNav, type NavItem } from "@/components/layout/nav";
import { LiveIndicator, RealtimeProvider } from "@/components/layout/realtime";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requirePageActor } from "@/server/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/server/authorization/permissions";
import { initials } from "@/lib/cn";

const NAV: (NavItem & { permission?: Permission })[] = [
  { href: "/dashboard", label: "Employee Directory", icon: "directory", permission: "employee:read" },
  { href: "/employees/new", label: "Add Employee", icon: "add", permission: "employee:create" },
  { href: "/employees/import", label: "Bulk Import", icon: "import", permission: "employee:create" },
  { href: "/activity", label: "Activity Log", icon: "activity", permission: "audit:read" },
  { href: "/settings", label: "System Rules", icon: "rules", permission: "settings:manage" },
  { href: "/users", label: "Users & Access", icon: "users", permission: "users:manage" },
  { href: "/account/security", label: "Account Security", icon: "security" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // allowWithoutMfa: the layout must render for the MFA enrolment page itself;
  // every page below calls requirePageActor() again with the MFA check enforced.
  const { actor } = await requirePageActor(undefined, { allowWithoutMfa: true });
  // Menu visibility is cosmetic; every page and API re-checks permissions server-side.
  const items = NAV.filter((n) => !n.permission || can(actor, n.permission)).map(({ href, label, icon }) => ({ href, label, icon }));

  return (
    <RealtimeProvider>
      <div className="flex min-h-screen">
        <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy-900 px-4 py-5 lg:flex">
          <Link href="/dashboard" className="mb-8 rounded-md px-1">
            <Logo tone="light" />
          </Link>
          <SidebarNav items={items} />
          <div className="mt-auto rounded-lg bg-white/6 p-3 text-xs text-white/70">
            <p className="flex items-center gap-1.5 font-semibold text-teal-50">
              <ShieldCheck className="size-3.5" aria-hidden /> Restricted HR environment
            </p>
            <p className="mt-1">Access is logged. Handle employee data per company policy.</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-20 border-b border-border bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="lg:hidden">
                  <Logo showText={false} />
                </span>
                <span className="hidden items-center gap-1.5 rounded-full bg-navy-100 px-2.5 py-1 text-xs font-semibold text-navy-800 sm:inline-flex">
                  <ShieldCheck className="size-3.5" aria-hidden /> Restricted HR environment
                </span>
                <LiveIndicator />
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium text-ink">{actor.name}</p>
                  <p className="text-xs text-ink-subtle">{ROLE_LABELS[actor.role]}</p>
                </div>
                <span className="grid size-9 place-items-center rounded-full bg-navy-800 text-xs font-semibold text-white" aria-hidden>
                  {initials(actor.name)}
                </span>
                <SignOutButton />
              </div>
            </div>
            <div className="px-4 pb-3 sm:px-6 lg:hidden">
              <MobileNav items={items} />
            </div>
          </header>
          <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
