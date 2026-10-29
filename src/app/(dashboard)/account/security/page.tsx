import type { Metadata } from "next";
import { requirePageActor, mfaSetupRequired } from "@/server/auth/session";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { MfaSetup } from "@/components/auth/mfa-setup";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata: Metadata = { title: "Account security" };

export default async function SecurityPage() {
  const { actor } = await requirePageActor(undefined, { allowWithoutMfa: true });
  const required = await mfaSetupRequired(actor);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader eyebrow="Your account" title="Account Security" description={`Signed in as ${actor.email}.`} />
      {required && (
        <Alert tone="warning" title="Multi-factor authentication required">
          Your role requires an authenticator app. Set it up below to continue to the dashboard.
        </Alert>
      )}
      <MfaSetup enabled={actor.twoFactorEnabled} />
      <ChangePasswordForm />
    </div>
  );
}
