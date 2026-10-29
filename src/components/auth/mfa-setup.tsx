"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card, CardHeader } from "@/components/ui/primitives";

type Stage = { kind: "idle" } | { kind: "scan"; qrSvg: string; secret: string; backupCodes: string[] } | { kind: "disable" };

export function MfaSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data || !("totpURI" in data)) {
      setError(error?.status === 429 ? "Too many attempts. Wait a minute." : "Password is incorrect.");
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setStage({ kind: "scan", qrSvg: await QRCode.toString(data.totpURI, { type: "svg", margin: 1 }), secret, backupCodes: data.backupCodes });
    setPassword("");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) {
      setError("That code didn't match. Check your device's time and try again.");
      return;
    }
    toast.success("Multi-factor authentication enabled");
    setStage({ kind: "idle" });
    router.replace("/account/security");
    router.refresh();
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) {
      setError("Password is incorrect.");
      return;
    }
    toast.success("Multi-factor authentication disabled");
    setStage({ kind: "idle" });
    setPassword("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Sign-in protection"
        title="Authenticator app (TOTP)"
        description="Use Google Authenticator, Microsoft Authenticator, 1Password or similar."
        actions={enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Not set up</Badge>}
      />
      <div className="space-y-4 p-5">
        {error && <Alert tone="danger">{error}</Alert>}

        {stage.kind === "idle" && !enabled && (
          <form onSubmit={start} className="space-y-3">
            <Field label="Confirm your password to begin" htmlFor="mfa-password">
              <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" loading={busy}>
              Set up authenticator
            </Button>
          </form>
        )}

        {stage.kind === "scan" && (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">1. Scan this QR with your authenticator app.</p>
            <div
              className="size-48 rounded-lg border border-border bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
              role="img"
              aria-label="Authenticator setup QR code"
              dangerouslySetInnerHTML={{ __html: stage.qrSvg }}
            />
            <p className="text-xs text-ink-muted">
              Can&apos;t scan? Enter this key manually: <code className="rounded bg-page px-1.5 py-0.5 font-mono break-all">{stage.secret}</code>
            </p>
            <div>
              <p className="text-sm text-ink-muted">2. Save these one-time backup codes somewhere safe. Each works once if you lose your device.</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-page p-3 font-mono text-sm sm:grid-cols-3">
                {stage.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <form onSubmit={confirm} className="space-y-3">
              <Field label="3. Enter the 6-digit code from the app" htmlFor="mfa-code">
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} required className="max-w-40" />
              </Field>
              <Button type="submit" loading={busy}>
                Verify and enable
              </Button>
            </form>
          </div>
        )}

        {enabled && stage.kind === "idle" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">You&apos;ll be asked for a code from your authenticator each time you sign in.</p>
            <Button variant="danger" size="sm" onClick={() => setStage({ kind: "disable" })}>
              Disable
            </Button>
          </div>
        )}

        {stage.kind === "disable" && (
          <form onSubmit={disable} className="space-y-3">
            <Alert tone="warning">If your role requires MFA you will need to set it up again before using the dashboard.</Alert>
            <Field label="Confirm your password" htmlFor="mfa-disable-password">
              <Input id="mfa-disable-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStage({ kind: "idle" })}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={busy}>
                Disable MFA
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
