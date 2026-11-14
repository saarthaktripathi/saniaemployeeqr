"use client";

import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { api, ApiError } from "@/lib/api-client";
import { formatClock } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";
import { toast } from "sonner";

interface OpenState {
  since: string;
  timezone: string;
  policy: "ALLOW" | "WARN" | "BLOCK";
}

async function signOutNow() {
  await authClient.signOut();
  // Full page load on purpose: discards all client-side state after the session ends.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

/**
 * Account menu for the employee workspace with the attendance sign-out guard: signing out never
 * punches out. Depending on the policy, someone still punched in is warned (and offered a punch-out
 * first) or must punch out before signing out.
 */
export function WorkspaceUserMenu({ name, role, consoleHref }: { name: string; role: string; consoleHref?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [busy, setBusy] = useState<"out" | "signout" | null>(null);

  async function beforeSignOut(): Promise<boolean> {
    try {
      const s = await api<{ open: { punchInAt: string } | null; timezone: string; policy: { logoutPolicy: OpenState["policy"] } }>("/api/me/attendance");
      if (!s.open || s.policy.logoutPolicy === "ALLOW") return true;
      setOpen({ since: s.open.punchInAt, timezone: s.timezone, policy: s.policy.logoutPolicy });
      dialog.current?.showModal();
      return false;
    } catch {
      return true; // never trap someone in the app because the check failed
    }
  }

  async function punchOutAndSignOut() {
    setBusy("out");
    try {
      await api("/api/me/attendance/punch-out", { body: {} });
      toast.success("Punched out");
      await signOutNow();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not punch out");
      setBusy(null);
    }
  }

  return (
    <>
      <UserMenu name={name} role={role} consoleHref={consoleHref} securityHref="/me/settings" onBeforeSignOut={beforeSignOut} />
      <dialog
        ref={dialog}
        aria-labelledby="logout-guard-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) dialog.current?.close();
        }}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/40"
        data-testid="logout-guard"
      >
        {open && (
          <div className="p-5">
            <h2 id="logout-guard-title" className="text-lg font-semibold">
              You are still punched in
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              You punched in at <span className="font-semibold text-ink">{formatClock(open.since, open.timezone)}</span>. Signing out does <strong>not</strong> punch you out.
              {open.policy === "BLOCK"
                ? " Your company requires you to punch out before signing out."
                : " If you sign out without punching out, your session keeps running and HR will see it as open until you punch out or HR corrects it."}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => dialog.current?.close()} disabled={busy !== null}>
                Cancel
              </Button>
              {open.policy === "WARN" && (
                <Button
                  type="button"
                  variant="ghost"
                  loading={busy === "signout"}
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy("signout");
                    await signOutNow();
                  }}
                >
                  Sign out, stay punched in
                </Button>
              )}
              <Button type="button" loading={busy === "out"} disabled={busy !== null} onClick={punchOutAndSignOut}>
                Punch out &amp; sign out
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
