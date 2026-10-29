import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Card } from "@/components/ui/primitives";
import { LoginForm } from "@/components/auth/login-form";
import { getActorFromHeaders } from "@/server/auth/session";

export const metadata: Metadata = { title: "HR sign in" };

export default async function LoginPage() {
  if (await getActorFromHeaders(await headers())) redirect("/dashboard");
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 rounded-md">
        <Logo />
      </Link>
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-wider text-teal-700 uppercase">
          <Lock className="size-3.5" aria-hidden /> Restricted HR environment
        </div>
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">For authorized Sania Job Bowl owners and HR personnel only.</p>
        <LoginForm />
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-ink-subtle">
        Accounts are issued by the company owner. If you need access or have forgotten your password, contact your administrator.
      </p>
      <Link href="/" className="mt-3 text-sm font-medium text-primary-600 hover:underline">
        ← Public verification
      </Link>
    </main>
  );
}
