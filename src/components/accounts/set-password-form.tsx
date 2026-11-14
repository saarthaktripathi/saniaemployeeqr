"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

/** Choose-a-password form shared by invitation and password-reset links. */
export function SetPasswordForm({ endpoint, email, submitLabel, doneTitle }: { endpoint: string; email: string; submitLabel: string; doneTitle: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: { password, confirmPassword: confirm } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 space-y-4 text-center" data-testid="password-set">
        <CheckCircle2 className="mx-auto size-10 text-success-700" aria-hidden />
        <p className="font-semibold text-ink">{doneTitle}</p>
        <p className="text-sm text-ink-muted">
          Sign in with <span className="font-medium text-ink">{email}</span> and your new password.
        </p>
        <Link href="/login" className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Login email" htmlFor="login-email">
        <Input id="login-email" type="email" value={email} readOnly autoComplete="username" />
      </Field>
      <Field label="New password" htmlFor="new-password" hint="At least 12 characters. A short sentence is easy to remember." required>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={128} required autoFocus />
      </Field>
      <Field label="Confirm password" htmlFor="confirm-password" required>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} required />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
