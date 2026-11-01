"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/cn";
import { AUDIT_LABELS } from "@/components/audit/audit-list";
import type { AuditRow } from "@/server/services/audit-read";

const SEEN_KEY = "sjb_notifications_seen";

function readSeen(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Header bell: the most recent audited activity (what the Activity Log shows), with an
 * unread count since the menu was last opened. Refetches only when a live change event
 * arrives (debounced), never on a timer.
 */
export function Notifications() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [open, setOpen] = useState(false);
  // Safe on the server (returns 0); only affects the badge, which needs client-fetched rows anyway.
  const [seen, setSeen] = useState(readSeen);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ rows: AuditRow[] }>("/api/audit?limit=8").then(
        (res) => setRows(res.rows),
        () => setRows((r) => r ?? []),
      );
    load();
    const onChange = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 1500);
    };
    window.addEventListener("sjb:change", onChange);
    return () => {
      window.removeEventListener("sjb:change", onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Items stay marked "new" while the menu is open; they count as seen once it closes.
  const close = useCallback(() => {
    setOpen(false);
    setSeen(readSeen());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const unread = rows?.filter((r) => new Date(r.createdAt).getTime() > seen).length ?? 0;

  const toggle = () => {
    if (open) return close();
    setOpen(true);
    if (rows?.[0]) {
      try {
        localStorage.setItem(SEEN_KEY, String(new Date(rows[0].createdAt).getTime()));
      } catch {}
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-navy-100 hover:text-ink"
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-primary-600 px-1 text-[10px] leading-4 font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-border bg-white shadow-[var(--shadow-lift)] transition-[opacity,transform] duration-150",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-ink">Recent activity</p>
          <Link href="/activity" onClick={close} className="text-xs font-medium text-primary-600 hover:underline" role="menuitem">
            View all
          </Link>
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {rows === null && <li className="px-4 py-6 text-center text-sm text-ink-subtle">Loading…</li>}
          {rows?.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-subtle">No activity yet.</li>}
          {rows?.map((r) => (
            <li key={r.id} className="px-4 py-2.5">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                {new Date(r.createdAt).getTime() > seen && <span className="size-1.5 shrink-0 rounded-full bg-violet-600" aria-label="New" />}
                {AUDIT_LABELS[r.action] ?? r.action}
              </p>
              <p className="text-xs text-ink-subtle">
                {r.actorName ?? "System"} · {formatDateTime(r.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
