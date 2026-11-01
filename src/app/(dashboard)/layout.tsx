import { ShieldCheck } from "lucide-react";
import { cookies } from "next/headers";
import { Logo } from "@/components/layout/logo";
import { MobileNav, Sidebar, type NavItem } from "@/components/layout/nav";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { Notifications } from "@/components/layout/notifications";
import { LiveIndicator, RealtimeProvider } from "@/components/layout/realtime";
import { UserMenu } from "@/components/layout/user-menu";
import { requirePageActor } from "@/server/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/server/authorization/permissions";

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
        <Sidebar items={items} initialCollapsed={collapsed} logo={<Logo tone="light" />} />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Soft colour wash behind every page (fixed, GPU-cheap, no images). */}
          <div className="no-print pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_85%_0%,rgb(167_139_250/0.16),transparent_70%),radial-gradient(45%_40%_at_10%_35%,rgb(34_211_238/0.10),transparent_70%),radial-gradient(50%_45%_at_70%_100%,rgb(244_114_182/0.10),transparent_70%),linear-gradient(180deg,#f6f7fe_0%,#f3f5fc_100%)]" aria-hidden />
          <header className="no-print sticky top-0 z-20 bg-white/70 shadow-[0_1px_0_rgb(225_231_240/0.8)] backdrop-blur-md">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <MobileNav items={items} user={user} logo={<Logo tone="light" />} />
                <span className="lg:hidden">
                  <Logo showText={false} />
                </span>
                <span className="hidden items-center gap-2 rounded-full border border-primary-100 bg-[#eef1ff] px-3.5 py-1.5 text-xs font-semibold text-navy-800 md:inline-flex">
                  <ShieldCheck className="size-4 text-primary-600" aria-hidden /> Restricted HR environment
                </span>
                <LiveIndicator />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                {can(actor, "audit:read") && <Notifications />}
                <UserMenu name={user.name} role={user.role} />
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
