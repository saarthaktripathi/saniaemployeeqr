import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = { title: "System rules" };

export default async function SettingsPage() {
  await requirePageActor("settings:manage");
  const s = await getSettings(db);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Owner controls" title="System Rules" description="Company-wide identity and verification policies. Every change is recorded in the activity log." />
      <SettingsForm
        initial={{
          companyName: s.companyName,
          tagline: s.tagline,
          employeeIdPrefix: s.employeeIdPrefix,
          defaultIdValidityDays: s.defaultIdValidityDays,
          credentialValidityDays: s.credentialValidityDays,
          expiryWarningDays: s.expiryWarningDays,
          publicShowDepartment: s.publicShowDepartment,
          publicShowJobTitle: s.publicShowJobTitle,
          publicShowBusinessVertical: s.publicShowBusinessVertical,
          publicShowWorkLocation: s.publicShowWorkLocation,
          auditRetentionDays: s.auditRetentionDays,
          verificationRetentionDays: s.verificationRetentionDays,
          requireMfaForPrivileged: s.requireMfaForPrivileged,
        }}
      />
    </div>
  );
}
