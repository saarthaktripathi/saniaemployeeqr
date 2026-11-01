import { ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { Logo } from "@/components/layout/logo";
import { MobileNav, Sidebar, type NavItem } from "@/components/layout/nav";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { Notifications } from "@/components/layout/notifications";
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
  const user = { name: actor.name, role: ROLE_LABELS[actor.role] };
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <RealtimeProvider>
      <div className="flex min-h-screen">
        <Sidebar items={items} user={user} initialCollapsed={collapsed} logo={<Logo tone="light" />} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-20 border-b border-border/80 bg-white/85 backdrop-blur-md">
            <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <MobileNav items={items} user={user} logo={<Logo tone="light" />} />
                <span className="lg:hidden">
                  <Logo showText={false} />
                </span>
                <span className="hidden items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 md:inline-flex">
                  <ShieldCheck className="size-3.5" aria-hidden /> Restricted HR environment
                </span>
                <LiveIndicator />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                {can(actor, "audit:read") && <Notifications />}
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium text-ink">{actor.name}</p>
                  <p className="text-xs text-ink-subtle">{ROLE_LABELS[actor.role]}</p>
                </div>
                <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary-500 to-violet-600 text-xs font-semibold text-white" aria-hidden>
                  {initials(actor.name)}
                </span>
                <SignOutButton />
              </div>
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
