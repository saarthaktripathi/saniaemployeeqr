"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, LogIn, LogOut, MapPin } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatClock, formatDuration, formatLongDate, localDate, zonedParts } from "@/lib/time";
import { LOCATION_LABELS, type AttendanceLocation } from "@/features/attendance/schema";
import { DAY_STATUS_LABELS } from "@/features/attendance/rules";
import type { MyAttendanceToday } from "@/server/services/attendance";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/primitives";

const pad = (n: number) => String(n).padStart(2, "0");

/** Seconds the open session has run, counted from server time plus the client's elapsed time. */
function useTicker(serverNow: string) {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    // Keep the server's clock: device clocks are often off by minutes.
    offset.current = Date.parse(serverNow) - Date.now();
    const t = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(t);
  }, [serverNow]);
  return now;
}

/**
 * Employee attendance card: current date and time, work location, Punch IN / Punch OUT and the
 * running duration. All timestamps come from the server; the clock here is display only.
 */
export function AttendanceCard({ initial, employee }: { initial: MyAttendanceToday; employee: { name: string; code: string } }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [location, setLocation] = useState<AttendanceLocation>((initial.open?.location ?? initial.policy.allowedLocations[0] ?? "OFFICE") as AttendanceLocation);
  const [busy, setBusy] = useState(false);
  const now = useTicker(state.now);
  const tz = state.timezone;

  const reload = useCallback(async () => {
    try {
      setState(await api<MyAttendanceToday>("/api/me/attendance"));
    } catch {}
  }, []);

  // Server re-render (router.refresh) brings new initial data: adopt it.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setState(initial);
  }
  useEffect(() => {
    // Another tab or device punched: refresh this card.
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === "attendance.changed") void reload();
    };
    window.addEventListener("sjb:change", onChange);
    return () => window.removeEventListener("sjb:change", onChange);
  }, [reload]);

  async function punch(kind: "in" | "out") {
    setBusy(true);
    try {
      await api(`/api/me/attendance/punch-${kind}`, { body: kind === "in" ? { location } : {} });
      toast.success(kind === "in" ? "Punched in. Have a great day!" : "Punched out. See you tomorrow!");
      await reload();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const p = zonedParts(new Date(now), tz);
  const open = state.open;
  const runningSeconds = open ? Math.max(0, Math.floor((now - Date.parse(open.punchInAt)) / 1000)) : 0;
  const closedToday = state.sessions.filter((s) => s.status !== "OPEN" && s.status !== "VOIDED");
  const workedToday = state.summary.workedSeconds + (open && !open.stale ? Math.max(0, Math.floor((now - Date.parse(state.now)) / 1000)) : 0);
  const today = localDate(new Date(now), tz);

  return (
    <Card className="overflow-hidden" data-testid="attendance-card">
      <div className={cn("relative px-5 py-5 text-white sm:px-6", open ? "bg-[linear-gradient(120deg,#0f572c_0%,#168242_55%,#138670_100%)]" : "bg-[linear-gradient(120deg,#171d4a_0%,#2e3a97_55%,#5358a6_100%)]")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wider text-white/75 uppercase">Today’s attendance</p>
            <p className="mt-1 text-sm text-white/85">{formatLongDate(today)}</p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums" aria-label="Current time" suppressHydrationWarning>
              {pad(p.hour)}:{pad(p.minute)}
              <span className="text-2xl text-white/70">:{pad(p.second)}</span>
            </p>
            <p className="mt-1 text-xs text-white/70">
              {employee.name} · {employee.code} · Shift {state.policy.shiftStart}–{state.policy.shiftEnd}
            </p>
          </div>
          <div className="sm:text-right">
            <Badge tone={open ? "success" : "neutral"} className="bg-white/90">
              <span data-testid="attendance-status">{open ? (open.stale ? "Session still open" : "Punched in") : DAY_STATUS_LABELS[state.summary.status]}</span>
            </Badge>
            {open && (
              <p className="mt-3 font-mono text-3xl font-bold tabular-nums" data-testid="running-duration" suppressHydrationWarning>
                {pad(Math.floor(runningSeconds / 3600))}:{pad(Math.floor((runningSeconds % 3600) / 60))}:{pad(runningSeconds % 60)}
              </p>
            )}
            {open && <p className="text-xs text-white/75">since {formatClock(open.punchInAt, tz)}</p>}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        {open?.stale && (
          <div role="alert" className="flex gap-3 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-warning-700/20">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Your session from {formatLongDate(open.workDate)} is still open (longer than {state.policy.maxSessionHours} hours). Punch out now, then{" "}
              <Link href={`/me/attendance?month=${open.workDate.slice(0, 7)}`} className="font-semibold underline">
                request a correction
              </Link>{" "}
              with your real punch-out time.
            </p>
          </div>
        )}

        {open ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <MapPin className="size-4 text-primary-600" aria-hidden /> {LOCATION_LABELS[open.location as AttendanceLocation]}
            </div>
            <Button size="md" variant="danger" onClick={() => punch("out")} loading={busy} className="min-w-40" data-testid="punch-out">
              <LogOut className="size-4" aria-hidden /> Punch OUT
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-56 flex-1">
              <label htmlFor="work-location" className="mb-1.5 block text-sm font-medium text-ink">
                Where are you working today?
              </label>
              <Select id="work-location" value={location} onChange={(e) => setLocation(e.target.value as AttendanceLocation)} disabled={busy}>
                {state.policy.allowedLocations.map((l) => (
                  <option key={l} value={l}>
                    {LOCATION_LABELS[l as AttendanceLocation]}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="md" onClick={() => punch("in")} loading={busy} className="min-w-40" data-testid="punch-in">
              <LogIn className="size-4" aria-hidden /> Punch IN
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
          <span className="flex items-center gap-2 text-ink-muted">
            <Clock className="size-4" aria-hidden /> Worked today: <span className="font-semibold text-ink" data-testid="worked-today">{formatDuration(workedToday)}</span>
          </span>
          {state.summary.firstIn && (
            <span className="text-ink-muted">
              First in <span className="font-medium text-ink">{formatClock(state.summary.firstIn, tz)}</span>
              {state.summary.late && <Badge tone="warning" className="ml-2">Late</Badge>}
            </span>
          )}
          {closedToday.length > 0 && (
            <span className="text-ink-muted">
              Sessions: <span className="font-medium text-ink">{closedToday.map((s) => `${formatClock(s.punchInAt, tz)}–${formatClock(s.punchOutAt, tz)}`).join(", ")}</span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
