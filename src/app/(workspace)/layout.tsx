import { UserRound } from "lucide-react";
import { cookies } from "next/headers";
import { Logo } from "@/components/layout/logo";
import { MobileNav, Sidebar, type NavItem } from "@/components/layout/nav";
import { LiveIndicator, RealtimeProvider } from "@/components/layout/realtime";
import { WorkspaceUserMenu } from "@/components/workspace/workspace-user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isWorkspaceRole, ROLE_LABELS } from "@/server/authorization/permissions";

const NAV: NavItem[] = [
  { href: "/me", label: "My Dashboard", icon: "home" },
  { href: "/me/attendance", label: "My Attendance", icon: "attendance" },
  { href: "/me/tasks", label: "My Tasks", icon: "tasks" },
  { href: "/me/calendar", label: "My Calendar", icon: "calendar" },
  { href: "/me/leave", label: "My Leave", icon: "leave" },
  { href: "/me/profile", label: "My Profile", icon: "profile" },
  { href: "/me/notifications", label: "Notifications", icon: "notifications" },
  { href: "/me/settings", label: "Account Settings", icon: "settings" },
];

const TEAM_NAV: NavItem[] = [
  { href: "/me/team", label: "My Team", icon: "team" },
  { href: "/me/team/tasks", label: "Team Tasks", icon: "tasks" },
];

/**
 * Employee self-service workspace. Separate navigation from the HR console; every page and API
 * still checks access server-side (and the database enforces row-level security underneath).
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireWorkspaceActor({ allowWithoutMfa: true });
  const items = actor.role === "TEAM_MANAGER" ? [NAV[0]!, ...TEAM_NAV, ...NAV.slice(1)] : NAV;
  const user = { name: actor.name, role: ROLE_LABELS[actor.role] };
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <RealtimeProvider>
      <div className="flex min-h-screen">
        <Sidebar items={items} initialCollapsed={collapsed} homeHref="/me" logo={<Logo tone="light" />} quote="Small steps every day add up to big results." />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="no-print pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_85%_0%,rgb(134_143_218/0.18),transparent_70%),radial-gradient(45%_40%_at_10%_35%,rgb(94_108_206/0.08),transparent_70%),linear-gradient(180deg,#f5f5f8_0%,#f0f0f2_100%)]" aria-hidden />
          <header className="no-print sticky top-0 z-20 bg-white/70 shadow-[0_1px_0_rgb(227_227_234/0.8)] backdrop-blur-md">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <MobileNav items={items} user={user} logo={<Logo tone="light" />} />
                <span className="lg:hidden">
                  <Logo showText={false} />
                </span>
                <span className="hidden items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3.5 py-1.5 text-xs font-semibold text-navy-800 md:inline-flex">
                  <UserRound className="size-4 text-primary-600" aria-hidden /> Employee workspace
                </span>
                <LiveIndicator />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                <NotificationBell href="/me/notifications" />
                <WorkspaceUserMenu name={user.name} role={user.role} consoleHref={isWorkspaceRole(actor.role) ? undefined : "/dashboard"} />
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
