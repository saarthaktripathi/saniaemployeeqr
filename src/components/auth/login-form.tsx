"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";

type Step = "password" | "totp" | "backup";

function messageFor(status: number | undefined): string {
  if (status === 429) return "Too many attempts. Please wait a minute before trying again.";
  // Same message for unknown email and wrong password (no account enumeration).
  return "Invalid email or password.";
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(messageFor(error.status));
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("totp");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      step === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false })
        : await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: false });
    setBusy(false);
    if (res.error) {
      setError(res.error.status === 429 ? messageFor(429) : "That code is not valid. Try again.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  if (step !== "password") {
    return (
      <form onSubmit={submitCode} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={step === "totp" ? "Authenticator code" : "Backup code"} htmlFor="code" required>
          <Input
            id="code"
            inputMode={step === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={step === "totp" ? 8 : 32}
            required
          />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Verify
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm font-medium text-primary-600 hover:underline"
          onClick={() => {
            setStep(step === "totp" ? "backup" : "totp");
            setCode("");
            setError(null);
          }}
        >
          {step === "totp" ? "Use a backup code instead" : "Use authenticator app instead"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="mt-6 space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Work email" htmlFor="email" required>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}
