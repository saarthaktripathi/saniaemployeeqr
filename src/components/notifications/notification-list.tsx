"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/primitives";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Full notification history with unread filter, paging and mark-as-read. */
export function NotificationList() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (before?: string) => {
      const qs = new URLSearchParams({ limit: "20", ...(onlyUnread ? { unread: "1" } : {}), ...(before ? { before } : {}) });
      return api<{ items: Item[]; unread: number; nextBefore: string | null }>(`/api/notifications?${qs}`).then(
        (res) => {
          setUnread(res.unread);
          setNext(res.nextBefore);
          setItems((cur) => (before && cur ? [...cur, ...res.items] : res.items));
        },
        () => setItems((cur) => cur ?? []),
      );
    },
    [onlyUnread],
  );

  useEffect(() => {
    void load();
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === "notification.created") void load();
    };
    window.addEventListener("sjb:change", onChange);
    return () => window.removeEventListener("sjb:change", onChange);
  }, [load]);

  async function markAll() {
    await api("/api/notifications/read", { body: { all: true } });
    await load();
  }

  async function open(n: Item) {
    if (!n.readAt) await api("/api/notifications/read", { body: { ids: [n.id] } }).catch(() => {});
    if (n.link) router.push(n.link);
    else void load();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex gap-1" role="tablist" aria-label="Filter">
          {[
            { k: false, label: "All" },
            { k: true, label: `Unread${unread ? ` (${unread})` : ""}` },
          ].map((t) => (
            <button
              key={String(t.k)}
              type="button"
              role="tab"
              aria-selected={onlyUnread === t.k}
              onClick={() => setOnlyUnread(t.k)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", onlyUnread === t.k ? "bg-primary-600 text-white" : "text-ink-muted hover:bg-navy-100")}
            >
              {t.label}
            </button>
          ))}
        </div>
        {unread > 0 && (
          <Button size="sm" variant="secondary" onClick={markAll}>
            <CheckCheck className="size-4" aria-hidden /> Mark all read
          </Button>
        )}
      </div>
      {items === null ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell className="size-5" aria-hidden />} title={onlyUnread ? "No unread notifications" : "No notifications yet"} description="Task, leave and attendance updates will appear here." />
      ) : (
        <ul className="divide-y divide-border" data-testid="notification-list">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={cn("flex w-full gap-3 px-5 py-3 text-left hover:bg-navy-100/40", !n.readAt && "bg-primary-50/40")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-violet-600")} aria-label={n.readAt ? undefined : "Unread"} />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{n.title}</span>
                  {n.body && <span className="block text-sm whitespace-pre-line text-ink-muted">{n.body}</span>}
                  <span className="block text-xs text-ink-subtle">{formatDateTime(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="border-t border-border p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            loading={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(next);
              setLoadingMore(false);
            }}
          >
            Load older
          </Button>
        </div>
      )}
    </Card>
  );
}
