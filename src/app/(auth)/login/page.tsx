import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lock, ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Card } from "@/components/ui/primitives";
import { LoginForm } from "@/components/auth/login-form";
import { cn } from "@/lib/cn";
import { getActorFromHeaders, homePathFor } from "@/server/auth/session";

type Portal = "employee" | "hr";

interface LoginProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/** Both portals accept the same accounts; the portal only sets the wording and where you land. */
const PORTALS = {
  employee: {
    title: "Employee login",
    icon: UserRound,
    eyebrow: "Employee sign in",
    intro: "Punch in and out, and see your tasks, leave and profile. Use the email HR set up your account with.",
    footer: "First time here? Open the invitation link HR sent you to set your password, then sign in.",
  },
  hr: {
    title: "HR login",
    icon: Lock,
    eyebrow: "Authorized HR sign in",
    intro: "Employee directory, ID cards, attendance and approvals for HR and management staff.",
    footer: "Accounts are created by invitation from HR. If you need access, contact your HR team.",
  },
} as const;

const TABS = [
  { portal: "employee", label: "Employee", extra: "", href: "/login?portal=employee", icon: UserRound },
  { portal: "hr", label: "HR", extra: " & Management", href: "/login", icon: ShieldCheck },
] as const;

function portalFrom(value: string | undefined): Portal {
  return value === "employee" ? "employee" : "hr";
}

export async function generateMetadata({ searchParams }: LoginProps): Promise<Metadata> {
  return { title: PORTALS[portalFrom((await searchParams).portal)].title };
}

export default async function LoginPage({ searchParams }: LoginProps) {
  const portal = portalFrom((await searchParams).portal);
  const actor = await getActorFromHeaders(await headers());
  if (actor) redirect(portal === "employee" && actor.employeeId ? "/me" : homePathFor(actor));
  const copy = PORTALS[portal];
  const Icon = copy.icon;
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 rounded-md">
        <Logo />
      </Link>
      <Card className="w-full max-w-sm p-6">
        <nav aria-label="Sign-in portal" className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-navy-100/70 p-1 text-sm font-medium">
          {TABS.map(({ portal: key, label, extra, href, icon: TabIcon }) => (
            <Link
              key={key}
              href={href}
              replace
              aria-current={portal === key ? "page" : undefined}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-2 py-2 transition-colors",
                portal === key ? "bg-white text-navy-900 shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              <TabIcon className="size-4" aria-hidden />
              <span>
                {label}
                {/* Shortened on phones so both tabs stay on one line. */}
                {extra && <span className="hidden sm:inline">{extra}</span>}
              </span>
            </Link>
          ))}
        </nav>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-teal-700 uppercase">
          <Icon className="size-3.5" aria-hidden /> {copy.eyebrow}
        </div>
        <h1 className="text-xl font-semibold text-ink">{copy.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{copy.intro}</p>
        {/* Employees go straight to their workspace; HR goes through /home, which routes by role. */}
        <LoginForm key={portal} redirectTo={portal === "employee" ? "/me" : "/home"} />
        <Link href="/forgot-password" className="mt-4 block text-center text-sm font-medium text-primary-600 hover:underline">
          Forgot password?
        </Link>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-ink-subtle">{copy.footer}</p>
      <Link href="/" className="mt-3 text-sm font-medium text-primary-600 hover:underline">
        ← Public verification
      </Link>
    </main>
  );
}
