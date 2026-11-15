import type { Metadata } from "next";
import { mfaSetupRequired, requireWorkspaceActor } from "@/server/auth/session";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { MfaSetup } from "@/components/auth/mfa-setup";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { mfaEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Account settings" };

export default async function MySettingsPage() {
  const { actor } = await requireWorkspaceActor({ allowWithoutMfa: true });
  const required = await mfaSetupRequired(actor);
  const mfa = mfaEnabled();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader eyebrow="Employee workspace" title="Account Settings" description={`Signed in as ${actor.email}. ${mfa ? "Change your password or add an authenticator app for extra protection." : "Change your password."}`} />
      {required && (
        <Alert tone="warning" title="Multi-factor authentication required">
          Your access requires an authenticator app. Set it up below to continue.
        </Alert>
      )}
      <ChangePasswordForm />
      {mfa && <MfaSetup enabled={actor.twoFactorEnabled} />}
    </div>
  );
}
