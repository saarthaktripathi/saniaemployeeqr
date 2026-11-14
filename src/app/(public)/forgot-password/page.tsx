import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <Card className="p-6">
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-primary-50 text-primary-600">
          <KeyRound className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-ink">Forgot your password?</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Ask your HR team for a password reset link. For your security, each link works once, expires after 24 hours, and signs you out of every
          device when used.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          HR administrators create the link from <span className="font-medium text-ink">Employee Access</span>. Owners reset HR accounts from{" "}
          <span className="font-medium text-ink">Users &amp; Access</span>.
        </p>
        <Link href="/login" className="mt-5 inline-block text-sm font-medium text-primary-600 hover:underline">
          ← Back to sign in
        </Link>
      </Card>
    </div>
  );
}
