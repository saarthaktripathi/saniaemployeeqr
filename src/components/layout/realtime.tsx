"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export type LiveState = "connecting" | "live" | "offline";

interface ChangeEvent {
  type: string;
  at: string;
  employeeId: string | null;
}

const LiveContext = createContext<LiveState>("connecting");
export const useLiveState = () => useContext(LiveContext);

/**
 * Subscribes to /api/events (SSE). Events only carry identifiers; on any change the
 * page's server components are re-rendered with fresh, authorized data via
 * router.refresh(). Reconnects with backoff and resyncs after gaps.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1_000;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let hadConnection = false;

    const refreshSoon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 350);
    };

    const connect = () => {
      if (stopped) return;
      setState("connecting");
      es = new EventSource("/api/events");
      es.addEventListener("ready", () => {
        setState("live");
        retry = 1_000;
        // After a reconnect, refetch in case events were missed.
        if (hadConnection) refreshSoon();
        hadConnection = true;
      });
      es.addEventListener("change", (e) => {
        const msg = e as MessageEvent<string>;
        let data: ChangeEvent | null = null;
        try {
          data = JSON.parse(msg.data) as ChangeEvent;
        } catch {}
        if (msg.lastEventId) {
          const key = `${msg.lastEventId}@${data?.at ?? ""}`;
          if (seen.current.has(key)) return; // duplicate delivery
          seen.current.add(key);
          if (seen.current.size > 1000) seen.current = new Set([...seen.current].slice(-500));
        }
        if (data) window.dispatchEvent(new CustomEvent("sjb:change", { detail: data }));
        refreshSoon();
      });
      es.addEventListener("resync", refreshSoon);
      es.addEventListener("unauthorized", () => {
        stopped = true;
        es?.close();
        // Full page load on purpose: discards all client-side state after the session ends.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      });
      es.onerror = () => {
        setState("offline");
        if (es?.readyState === EventSource.CLOSED) {
          // The browser gave up (e.g. non-200 response); retry ourselves with backoff.
          es.close();
          reconnectTimer = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 30_000);
        }
      };
    };

    connect();
    // Background tabs release their stream after a minute (saves server and database
    // resources); on return they reconnect and refetch.
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          es?.close();
          setState("offline");
        }, 60_000);
        return;
      }
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (es?.readyState === EventSource.CLOSED) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (timer.current) clearTimeout(timer.current);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function LiveIndicator() {
  const state = useLiveState();
  const label = { connecting: "Connecting…", live: "Live updates on", offline: "Reconnecting…" }[state];
  const color = { connecting: "bg-warning-700", live: "bg-success-700", offline: "bg-danger-600" }[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted" role="status" aria-live="polite" data-testid="live-indicator" data-state={state}>
      <span className={`relative flex size-2 rounded-full ${color}`}>
        {state === "live" && <span className={`absolute inline-flex size-full animate-ping rounded-full ${color} opacity-60`} />}
      </span>
      {label}
    </span>
  );
}
