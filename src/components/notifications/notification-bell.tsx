"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/time";

interface Item {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Header bell for personal notifications: unread count, the latest items and "mark all read".
 * Refetches when a live `notification.created` event arrives (debounced), never on a timer.
 */
export function NotificationBell({ href }: { href: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    api<{ items: Item[]; unread: number }>("/api/notifications?limit=8").then(
      (res) => {
        setItems(res.items);
        setUnread(res.unread);
      },
      () => setItems((i) => i ?? []),
    );
  }, []);

  useEffect(() => {
    load();
    const onChange = (e: Event) => {
      const type = (e as CustomEvent<{ type?: string }>).detail?.type;
      if (type && type !== "notification.created") return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 800);
    };
    window.addEventListener("sjb:change", onChange);
    return () => {
      window.removeEventListener("sjb:change", onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

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

  async function markAll() {
    await api("/api/notifications/read", { body: { all: true } }).catch(() => {});
    load();
  }

  async function openItem(n: Item) {
    setOpen(false);
    if (!n.readAt) await api("/api/notifications/read", { body: { ids: [n.id] } }).catch(() => {});
    load();
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="notification-bell"
        className="relative grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-navy-100 hover:text-ink"
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span data-testid="unread-count" className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-primary-600 px-1 text-[10px] leading-4 font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-border bg-white shadow-[var(--shadow-lift)] transition-[opacity,transform] duration-150",
          open ? "scale-100 opacity-100" : "pointer-events-none invisible scale-95 opacity-0",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          <div className="flex items-center gap-3">
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-ink-muted hover:text-ink">
                Mark all read
              </button>
            )}
            <Link href={href} onClick={() => setOpen(false)} className="text-xs font-medium text-primary-600 hover:underline" role="menuitem">
              View all
            </Link>
          </div>
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {items === null && <li className="px-4 py-6 text-center text-sm text-ink-subtle">Loading…</li>}
          {items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-subtle">You’re all caught up.</li>}
          {items?.map((n) => (
            <li key={n.id}>
              <button type="button" role="menuitem" onClick={() => openItem(n)} className="block w-full px-4 py-2.5 text-left hover:bg-navy-100/50">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-violet-600" aria-label="Unread" />}
                  <span className="line-clamp-2">{n.title}</span>
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>}
                <p className="mt-0.5 text-xs text-ink-subtle">{relativeTime(n.createdAt)}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
