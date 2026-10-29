"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader eyebrow="Password" title="Change password" description="Other devices will be signed out." />
      <form
        className="space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (next.length < 12) return setError("New password must be at least 12 characters.");
          if (next !== confirm) return setError("New passwords do not match.");
          setBusy(true);
          const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
          setBusy(false);
          if (error) return setError(error.status === 429 ? "Too many attempts. Wait a minute." : "Current password is incorrect.");
          setCurrent("");
          setNext("");
          setConfirm("");
          toast.success("Password changed");
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="pw-new" hint="At least 12 characters. A passphrase works well.">
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} maxLength={128} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm">
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" loading={busy}>
          Update password
        </Button>
      </form>
    </Card>
  );
}
