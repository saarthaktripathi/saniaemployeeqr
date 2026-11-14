import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { SetPasswordForm } from "@/components/accounts/set-password-form";
import { db } from "@/server/db/client";
import { inspectInvitation } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inspectInvitation(db, token);
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <Card className="p-6">
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-primary-50 text-primary-600">
          <UserPlus className="size-5" aria-hidden />
        </div>
        {invite ? (
          <>
            <h1 className="text-xl font-semibold text-ink">Welcome, {invite.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {invite.company} has invited you to the employee workspace ({invite.employeeCode}). Choose a password to activate your login.
            </p>
            <SetPasswordForm endpoint={`/api/public/invitations/${encodeURIComponent(token)}`} email={invite.email} submitLabel="Activate my account" doneTitle="Your account is ready" />
          </>
        ) : (
          <div data-testid="invite-invalid">
            <h1 className="text-xl font-semibold text-ink">This invitation can’t be used</h1>
            <p className="mt-2 text-sm text-ink-muted">The link is invalid, has already been used or has expired. Ask your HR team to send a new invitation.</p>
            <Link href="/login" className="mt-4 inline-block text-sm font-medium text-primary-600 hover:underline">
              Go to sign in
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
