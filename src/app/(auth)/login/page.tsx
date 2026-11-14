import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Card } from "@/components/ui/primitives";
import { LoginForm } from "@/components/auth/login-form";
import { getActorFromHeaders, homePathFor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const actor = await getActorFromHeaders(await headers());
  if (actor) redirect(homePathFor(actor));
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 rounded-md">
        <Logo />
      </Link>
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-wider text-teal-700 uppercase">
          <Lock className="size-3.5" aria-hidden /> Secure sign in
        </div>
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">Employees, team managers and HR of the Sania group. Use the email your account was set up with.</p>
        <LoginForm />
        <Link href="/forgot-password" className="mt-4 block text-center text-sm font-medium text-primary-600 hover:underline">
          Forgot password?
        </Link>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-ink-subtle">
        Accounts are created by invitation from HR. If you need access, contact your HR team.
      </p>
      <Link href="/" className="mt-3 text-sm font-medium text-primary-600 hover:underline">
        ← Public verification
      </Link>
    </main>
  );
}
