"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { LinkDialog } from "./link-dialog";

export interface AccountSubject {
  employeeId: string;
  displayName: string;
  workEmail: string | null;
  account: { userId: string; email: string; role: string; isActive: boolean } | null;
  invite: { id: string; email: string; role: string; expiresAt: string } | null;
}

type Pending = { options: ConfirmOptions; run: () => Promise<void> } | null;

function InviteDialog({ subject, open, onClose, onIssued }: { subject: AccountSubject; open: boolean; onClose: () => void; onIssued: (link: string, expiresAt: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setEmail(subject.invite?.email ?? subject.workEmail ?? "");
      setRole(subject.invite?.role ?? "EMPLOYEE");
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, subject]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ invitation: { link: string; expiresAt: string } }>("/api/accounts/invitations", { body: { employeeId: subject.employeeId, email, role } });
      onIssued(res.invitation.link, res.invitation.expiresAt);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Could not create the invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`invite-title-${subject.employeeId}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 id={`invite-title-${subject.employeeId}`} className="text-lg font-semibold">
            Invite {subject.displayName}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Creates a one-time link. The employee opens it and chooses their own password; the login is tied to this employee record.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        <Field label="Login email" htmlFor={`invite-email-${subject.employeeId}`} hint="Work or personal email they will sign in with" required>
          <Input id={`invite-email-${subject.employeeId}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoFocus />
        </Field>
        <Field label="Access" htmlFor={`invite-role-${subject.employeeId}`}>
          <Select id={`invite-role-${subject.employeeId}`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="EMPLOYEE">Employee: own attendance, tasks and leave</option>
            <option value="TEAM_MANAGER">Team manager: also their reporting team</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create invitation link
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/** Row/profile actions for one employee's login: invite, revoke, reset link, role, (de)activate. */
export function AccountActions({ subject, compact }: { subject: AccountSubject; compact?: boolean }) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ link: string; title: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const size = compact ? "sm" : "md";

  const confirm = (options: ConfirmOptions, run: () => Promise<void>) => setPending({ options, run });

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
      setPending(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function resetLink() {
    if (!subject.account) return;
    try {
      const res = await api<{ reset: { link: string; expiresAt: string } }>(`/api/accounts/${subject.account.userId}/reset-link`, { method: "POST" });
      setLink({ link: res.reset.link, title: `Password reset link for ${subject.displayName}`, expiresAt: res.reset.expiresAt });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the link");
    }
  }

  const a = subject.account;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!a && (
        <Button size={size} variant={subject.invite ? "secondary" : "primary"} onClick={() => setInviting(true)}>
          {subject.invite ? "New link" : "Invite"}
        </Button>
      )}
      {!a && subject.invite && (
        <Button
          size={size}
          variant="ghost"
          onClick={() =>
            confirm({ title: "Revoke invitation?", description: "The link stops working immediately.", confirmLabel: "Revoke", tone: "danger" }, async () => {
              await api(`/api/accounts/invitations/${subject.invite!.id}`, { method: "DELETE" });
              toast.success("Invitation revoked");
            })
          }
        >
          Revoke
        </Button>
      )}
      {a?.isActive && (
        <>
          <Button size={size} variant="secondary" onClick={resetLink}>
            Reset link
          </Button>
          <Button
            size={size}
            variant="ghost"
            onClick={() => {
              const next = a.role === "TEAM_MANAGER" ? "EMPLOYEE" : "TEAM_MANAGER";
              confirm(
                {
                  title: next === "TEAM_MANAGER" ? `Make ${subject.displayName} a team manager?` : `Remove team manager access?`,
                  description:
                    next === "TEAM_MANAGER"
                      ? "They will see attendance and tasks for everyone who reports to them (directly or indirectly) and can assign tasks to them."
                      : "They keep their own workspace but lose access to their team.",
                  confirmLabel: "Change access",
                },
                async () => {
                  await api(`/api/accounts/${a.userId}`, { method: "PATCH", body: { role: next } });
                  toast.success("Access updated. They will need to sign in again.");
                },
              );
            }}
          >
            {a.role === "TEAM_MANAGER" ? "Make employee" : "Make manager"}
          </Button>
          <Button
            size={size}
            variant="danger"
            onClick={() =>
              confirm({ title: `Deactivate ${subject.displayName}'s login?`, description: "They are signed out everywhere and cannot sign in until reactivated. Their records are kept.", confirmLabel: "Deactivate", tone: "danger" }, async () => {
                await api(`/api/accounts/${a.userId}`, { method: "PATCH", body: { isActive: false } });
                toast.success("Login deactivated");
              })
            }
          >
            Deactivate
          </Button>
        </>
      )}
      {a && !a.isActive && (
        <Button
          size={size}
          variant="success"
          onClick={() =>
            confirm({ title: `Reactivate ${subject.displayName}'s login?`, confirmLabel: "Reactivate" }, async () => {
              await api(`/api/accounts/${a.userId}`, { method: "PATCH", body: { isActive: true } });
              toast.success("Login reactivated");
            })
          }
        >
          Reactivate
        </Button>
      )}

      <InviteDialog
        subject={subject}
        open={inviting}
        onClose={() => setInviting(false)}
        onIssued={(l, expiresAt) => {
          setInviting(false);
          // Refresh only after the link dialog closes: on a filtered list the row would otherwise
          // move away (e.g. "No login" -> "Invited") and take the one-time link with it.
          setLink({ link: l, title: `Invitation link for ${subject.displayName}`, expiresAt });
        }}
      />
      <LinkDialog
        link={link?.link ?? null}
        title={link?.title ?? ""}
        expiresAt={link?.expiresAt}
        onClose={() => {
          setLink(null);
          router.refresh();
        }}
      />
      <ConfirmDialog open={pending !== null} options={pending?.options ?? { title: "" }} busy={busy} onCancel={() => setPending(null)} onConfirm={runPending} />
    </div>
  );
}
