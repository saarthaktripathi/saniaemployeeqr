"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        // Full page load on purpose: discards all client-side state after the session ends.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      }}
    >
      <LogOut className="size-4" aria-hidden />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
