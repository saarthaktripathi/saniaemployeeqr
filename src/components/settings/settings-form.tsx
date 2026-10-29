"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/primitives";

export interface SettingsValues {
  companyName: string;
  tagline: string;
  employeeIdPrefix: string;
  defaultIdValidityDays: number;
  credentialValidityDays: number;
  expiryWarningDays: number;
  publicShowDepartment: boolean;
  publicShowJobTitle: boolean;
  publicShowBusinessVertical: boolean;
  publicShowWorkLocation: boolean;
  auditRetentionDays: number;
  verificationRetentionDays: number;
  requireMfaForPrivileged: boolean;
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SettingsValues>(k: K, value: SettingsValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const num = (k: keyof SettingsValues) => ({
    id: k,
    type: "number",
    value: String(v[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
    "aria-invalid": errors[k] ? true : undefined,
  });

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          await api("/api/settings", { method: "PATCH", body: v });
          toast.success("System rules saved");
          router.refresh();
        } catch (err) {
          if (err instanceof ApiError) {
            setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
            toast.error(err.message);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Card>
        <CardHeader eyebrow="Branding" title="Company identity" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Company name" htmlFor="companyName" error={errors.companyName}>
            <Input id="companyName" value={v.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Tagline" htmlFor="tagline" error={errors.tagline}>
            <Input id="tagline" value={v.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Identifiers" title="Employee ID policy" description="IDs look like PREFIX-YEAR-###. The sequence restarts each calendar year; issued IDs are never reused or changed." />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="ID prefix" htmlFor="employeeIdPrefix" error={errors.employeeIdPrefix} hint="2–6 capital letters. Applies to new IDs only.">
            <Input id="employeeIdPrefix" value={v.employeeIdPrefix} maxLength={6} onChange={(e) => set("employeeIdPrefix", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Default ID validity (days)" htmlFor="defaultIdValidityDays" error={errors.defaultIdValidityDays}>
            <Input {...num("defaultIdValidityDays")} min={1} max={3650} />
          </Field>
          <Field label="Expiry warning (days)" htmlFor="expiryWarningDays" error={errors.expiryWarningDays} hint="Flags IDs as “expiring soon”.">
            <Input {...num("expiryWarningDays")} min={1} max={365} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="QR credentials" title="Credential & public verification" description="Credential expiry is independent of the employee ID's validity." />
        <div className="space-y-4 p-5">
          <Field label="QR credential validity (days)" htmlFor="credentialValidityDays" error={errors.credentialValidityDays} className="max-w-xs">
            <Input {...num("credentialValidityDays")} min={1} max={3650} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Fields shown on the public verification page</legend>
            <p className="mb-3 text-xs text-ink-muted">Name, employee ID, status and validity are always shown. Email and phone are never shown.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox label="Department" checked={v.publicShowDepartment} onChange={(e) => set("publicShowDepartment", e.target.checked)} />
              <Checkbox label="Job title" checked={v.publicShowJobTitle} onChange={(e) => set("publicShowJobTitle", e.target.checked)} />
              <Checkbox label="Business vertical" checked={v.publicShowBusinessVertical} onChange={(e) => set("publicShowBusinessVertical", e.target.checked)} />
              <Checkbox label="Work location" checked={v.publicShowWorkLocation} onChange={(e) => set("publicShowWorkLocation", e.target.checked)} />
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Security" title="Access & retention" />
        <div className="space-y-4 p-5">
          <Checkbox
            label="Require multi-factor authentication for Owners and HR Administrators"
            description="Privileged users without an authenticator app are sent to enrol before they can use the dashboard."
            checked={v.requireMfaForPrivileged}
            onChange={(e) => set("requireMfaForPrivileged", e.target.checked)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audit log retention (days)" htmlFor="auditRetentionDays" error={errors.auditRetentionDays} hint="Minimum 90. Older entries are purged by the retention job.">
              <Input {...num("auditRetentionDays")} min={90} max={3650} />
            </Field>
            <Field label="Verification event retention (days)" htmlFor="verificationRetentionDays" error={errors.verificationRetentionDays}>
              <Input {...num("verificationRetentionDays")} min={7} max={730} />
            </Field>
          </div>
          <p className="text-xs text-ink-muted">Sessions expire after 8 hours and refresh hourly while in use (server configuration).</p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          Save system rules
        </Button>
      </div>
    </form>
  );
}
