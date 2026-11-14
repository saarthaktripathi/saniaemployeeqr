import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { SetPasswordForm } from "@/components/accounts/set-password-form";
import { db } from "@/server/db/client";
import { inspectPasswordReset } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await inspectPasswordReset(db, token);
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <Card className="p-6">
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-primary-50 text-primary-600">
          <KeyRound className="size-5" aria-hidden />
        </div>
        {reset ? (
          <>
            <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
            <p className="mt-1 text-sm text-ink-muted">For {reset.name}. You will be signed out of every device.</p>
            <SetPasswordForm endpoint={`/api/public/password-reset/${encodeURIComponent(token)}`} email={reset.email} submitLabel="Set new password" doneTitle="Password changed" />
          </>
        ) : (
          <div data-testid="reset-invalid">
            <h1 className="text-xl font-semibold text-ink">This reset link can’t be used</h1>
            <p className="mt-2 text-sm text-ink-muted">The link is invalid, has already been used or has expired. Ask your HR team for a new one.</p>
            <Link href="/login" className="mt-4 inline-block text-sm font-medium text-primary-600 hover:underline">
              Go to sign in
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
