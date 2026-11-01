"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LockKeyhole, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn, initials } from "@/lib/cn";

/** Header account button: avatar, name and role, with Account Security and Sign out. */
export function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Account menu for ${name}`}
        className="flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-navy-100/70"
      >
        <span className="grid size-10 place-items-center rounded-full bg-[#0f1a3d] text-sm font-semibold text-white ring-2 ring-white" aria-hidden>
          {initials(name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-ink-subtle">{role}</span>
        </span>
        <ChevronDown className={cn("size-4 text-ink-muted transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-30 mt-2 w-56 origin-top-right rounded-xl border border-border bg-white p-1.5 shadow-[var(--shadow-lift)] transition-[opacity,transform] duration-150",
          open ? "scale-100 opacity-100" : "pointer-events-none invisible scale-95 opacity-0",
        )}
      >
        <div className="px-3 py-2 sm:hidden">
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-xs text-ink-subtle">{role}</p>
        </div>
        <Link href="/account/security" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-navy-100/70">
          <LockKeyhole className="size-4 text-ink-muted" aria-hidden /> Account security
        </Link>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await authClient.signOut();
            // Full page load on purpose: discards all client-side state after the session ends.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/login");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger-700 hover:bg-danger-50 disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
