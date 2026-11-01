"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, ExternalLink, IdCard, QrCode, RefreshCw, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CredentialBadge } from "./status-badges";
import { formatDate } from "@/lib/cn";
import type { CredentialState } from "@/features/employees/rules";

export interface CredentialPreview {
  id: string;
  url: string;
  qrSvg: string;
  issuedAt: string;
  expiresAt: string;
  state: CredentialState;
}

export function CredentialPanel({
  employeeId,
  preview,
  archived,
  inactive,
  perms,
}: {
  employeeId: string;
  preview: CredentialPreview | null;
  archived: boolean;
  inactive: boolean;
  perms: { issue: boolean; revoke: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"issue" | "revoke" | null>(null);

  async function issue() {
    setBusy(true);
    try {
      await api(`/api/employees/${employeeId}/credentials`, { body: {} });
      toast.success(preview ? "New QR issued — the previous QR no longer verifies" : "QR credential issued");
      setConfirm(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not issue credential");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(reason: string) {
    if (!preview) return;
    setBusy(true);
    try {
      await api(`/api/credentials/${preview.id}/revoke`, { body: { reason } });
      toast.success("QR credential revoked");
      setConfirm(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not revoke credential");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <ConfirmDialog
        open={confirm === "issue"}
        busy={busy}
        options={{
          title: preview ? "Reissue QR credential?" : "Issue QR credential?",
          description: preview
            ? "A new QR will be generated and the current one will stop verifying immediately. Printed IDs with the old QR must be replaced."
            : "A unique verification QR will be generated for this employee. Issuing a QR does not change their employment status.",
          confirmLabel: preview ? "Reissue" : "Issue QR",
        }}
        onCancel={() => setConfirm(null)}
        onConfirm={issue}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        busy={busy}
        options={{
          title: "Revoke QR credential?",
          description: "Anyone scanning this QR will see “Credential revoked”. This cannot be undone — issue a new QR if needed.",
          confirmLabel: "Revoke",
          tone: "danger",
          reasonLabel: "Reason (e.g. card lost)",
          reasonRequired: true,
        }}
        onCancel={() => setConfirm(null)}
        onConfirm={revoke}
      />
      <CardHeader eyebrow="Verification" title="QR credential" actions={preview ? <CredentialBadge state={preview.state} /> : undefined} />
      <div className="p-5">
        {preview ? (
          <div className="space-y-4">
            <div
              className="mx-auto aspect-square w-full max-w-60 rounded-xl border border-border bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
              role="img"
              aria-label="Employee verification QR code"
              data-testid="qr-preview"
              // Server-generated SVG from our canonical URL (not user-controlled).
              dangerouslySetInnerHTML={{ __html: preview.qrSvg }}
            />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-ink-subtle">Issued</dt>
                <dd>{formatDate(preview.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">QR valid until</dt>
                <dd>{formatDate(preview.expiresAt)}</dd>
              </div>
            </dl>
            {inactive && (
              <Alert tone="warning">This employee is inactive, so the QR currently shows “Inactive employee” when scanned.</Alert>
            )}
            <div>
              <label htmlFor="verify-url" className="text-xs text-ink-subtle">
                Verification URL
              </label>
              <input
                id="verify-url"
                readOnly
                value={preview.url}
                data-testid="verify-url"
                className="mt-1 block w-full truncate rounded-lg border border-border bg-page px-3 py-2 font-mono text-xs text-ink-muted"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(preview.url);
                    toast.success("Verification URL copied");
                  } catch {
                    toast.error("Copy failed — select the URL field instead");
                  }
                }}
              >
                <Copy className="size-4" aria-hidden /> Copy URL
              </Button>
              <ButtonLink href={`/employees/${employeeId}/id-card`} variant="secondary" size="sm">
                <IdCard className="size-4" aria-hidden /> ID card
              </ButtonLink>
              <a href={preview.url} target="_blank" rel="noreferrer noopener" className="col-span-2 inline-flex h-8 items-center justify-center gap-2 rounded-lg text-sm font-medium text-primary-600 hover:bg-primary-50">
                <ExternalLink className="size-4" aria-hidden /> Open public verification page
              </a>
            </div>
            {(perms.issue || perms.revoke) && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {perms.issue && (
                  <Button variant="secondary" size="sm" onClick={() => setConfirm("issue")}>
                    <RefreshCw className="size-4" aria-hidden /> Reissue
                  </Button>
                )}
                {perms.revoke && (
                  <Button variant="danger" size="sm" onClick={() => setConfirm("revoke")}>
                    <ShieldX className="size-4" aria-hidden /> Revoke
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<QrCode className="size-5" />}
            title="No active QR credential"
            description={archived ? "Archived employees cannot be issued credentials." : "Issue a QR to let verifiers confirm this employee's current status."}
            action={
              perms.issue && !archived ? (
                <Button onClick={() => setConfirm("issue")} data-testid="issue-qr">
                  <QrCode className="size-4" aria-hidden /> Issue QR credential
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </Card>
  );
}
